import type { ClientMessage, SdrAction, SdrSetup } from '../src/terminal/protocol.ts';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('Unsupported field');
}

export function mhz(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.000001 || value > 12_000) {
    throw new Error('Enter a frequency or span between 0.000001 and 12000 MHz');
  }
  return Math.round(value * 1e6) / 1e6;
}

export function validateSetup(value: unknown): SdrSetup {
  const v = object(value);
  keys(v, ['port', 'frequencyMHz', 'spanMHz', 'input']);
  if (typeof v.port !== 'string' || v.port.length > 240 ||
      !/^\/dev\/(?:(?:tty(?:USB|ACM)\d+)|(?:cu\.|tty\.)[A-Za-z0-9._-]+|serial\/by-(?:id|path)\/[A-Za-z0-9][A-Za-z0-9_:+.-]*)$/.test(v.port)) {
    throw new Error('Choose a tinySA serial path such as /dev/ttyACM0 or /dev/serial/by-id/…');
  }
  if (v.input !== undefined && (typeof v.input !== 'string' || !['auto', 'low', 'high'].includes(v.input))) {
    throw new Error('Unsupported tinySA input');
  }
  return {
    port: v.port, frequencyMHz: mhz(v.frequencyMHz), spanMHz: mhz(v.spanMHz),
    input: (v.input as SdrSetup['input']) ?? 'auto',
  };
}

export function validateAction(value: unknown): SdrAction {
  const v = object(value);
  if (v.action === 'launch') {
    keys(v, ['action', 'setup']);
    return { action: 'launch', setup: validateSetup(v.setup) };
  }
  if (v.action === 'frequency' || v.action === 'span') {
    keys(v, ['action', 'value']);
    return { action: v.action, value: mhz(v.value) };
  }
  keys(v, ['action']);
  if (v.action === 'rx-start' || v.action === 'rx-stop' || v.action === 'waterfall' || v.action === 'quit') {
    return { action: v.action };
  }
  throw new Error('Unsupported action');
}

export function validateMessage(value: unknown): ClientMessage {
  const v = object(value);
  if (v.type === 'action') {
    keys(v, ['type', 'id', 'command']);
    if (typeof v.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(v.id)) throw new Error('Invalid action ID');
    return { type: 'action', id: v.id, command: validateAction(v.command) };
  }
  if (v.type === 'resize') {
    keys(v, ['type', 'cols', 'rows']);
    if (!Number.isInteger(v.cols) || !Number.isInteger(v.rows) ||
      (v.cols as number) < 80 || (v.cols as number) > 160 || (v.rows as number) < 24 || (v.rows as number) > 60) {
      throw new Error('Terminal size must be 80–160 columns and 24–60 rows');
    }
    return { type: 'resize', cols: v.cols as number, rows: v.rows as number };
  }
  if (v.type === 'ack') {
    keys(v, ['type', 'sequence']);
    if (!Number.isSafeInteger(v.sequence) || (v.sequence as number) < 0) throw new Error('Invalid output acknowledgement');
    return { type: 'ack', sequence: v.sequence as number };
  }
  throw new Error('Unsupported message');
}

export function allowedHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export function allowedOrigin(origin: string | undefined, host: string | undefined, port: number): boolean {
  return allowedHost(host, port) && origin === `http://${host}`;
}
