#!/usr/bin/env -S node
// Auto-configures the tinySA (if one is plugged in), then starts the dev
// server and opens the presentation in Chrome once it's ready.
import { access, constants, readdir } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { SetupStore } from '../server/setup-store.ts';
import type { SdrSetup } from '../src/terminal/protocol.ts';

const port = Number(process.env.PORT || 5173);
const url = `http://127.0.0.1:${port}`;

// Fixed per the demo rig: the channel used for the Z-Wave EU Long Range slides.
const TINYSA_FREQUENCY_MHZ = 866.625;
const TINYSA_SPAN_MHZ = 6.65;

async function findTinySaPort(): Promise<string | null> {
  const byIdDir = '/dev/serial/by-id';
  try {
    const entries = await readdir(byIdDir);
    const matches = entries.filter((name) => /tinysa/i.test(name));
    if (matches.length > 1) {
      console.warn(`Multiple tinySA-like serial devices found; using ${matches[0]}. Candidates: ${matches.join(', ')}`);
    }
    if (matches.length > 0) return `${byIdDir}/${matches[0]}`;
  } catch {
    // No /dev/serial/by-id (not Linux, or nothing plugged in). Fall through.
  }
  return null;
}

async function isExecutable(path: string): Promise<boolean> {
  return access(path, constants.X_OK).then(() => true, () => false);
}

function onPath(bin: string): boolean {
  const check = process.platform === 'win32' ? spawnSync('where', [bin]) : spawnSync('command', ['-v', bin], { shell: true });
  return check.status === 0;
}

async function findSdrtopBin(): Promise<string | null> {
  if (process.env.SDRTOP_BIN) return null; // Already set explicitly; leave it alone.
  if (onPath('sdrtop')) return null; // The default 'sdrtop' lookup already works.
  // Fall back to a sibling sdrtop checkout's build output, release preferred over debug.
  const candidates = ['release', 'debug'].map((profile) => resolve(process.cwd(), '..', 'sdrtop', 'target', profile, 'sdrtop'));
  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

async function ensureSdrtopBinConfigured() {
  const found = await findSdrtopBin();
  if (!found) return;
  process.env.SDRTOP_BIN = found;
  console.log(`sdrtop found: ${found}`);
}

async function ensureTinySaConfigured() {
  const detectedPort = await findTinySaPort();
  if (!detectedPort) {
    console.warn('No tinySA found on a serial port. Plug it in and reopen the waterfall demo, or configure it manually there.');
    return;
  }
  const store = new SetupStore(process.env.SDRTOP_STATE_DIR);
  const setup: SdrSetup = { port: detectedPort, frequencyMHz: TINYSA_FREQUENCY_MHZ, spanMHz: TINYSA_SPAN_MHZ, input: 'auto' };
  await store.save(setup);
  console.log(`tinySA pre-configured: ${detectedPort} @ ${TINYSA_FREQUENCY_MHZ} MHz, span ${TINYSA_SPAN_MHZ} MHz`);
}

function openChrome(target: string) {
  const candidates: Record<string, string[]> = {
    linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
    darwin: ['/Applications/Google Chrome.app'],
    win32: ['chrome'],
  };
  const names = candidates[process.platform] ?? [];

  const tryNext = (index: number) => {
    if (index >= names.length) {
      console.error(`Could not find Chrome automatically. Open it manually at ${target}`);
      return;
    }
    const name = names[index];
    const child = process.platform === 'darwin'
      ? spawn('open', ['-a', name, target], { stdio: 'ignore' })
      : spawn(name, [target], { stdio: 'ignore', detached: true });
    child.on('error', () => tryNext(index + 1));
    child.unref?.();
  };
  tryNext(0);
}

async function waitForServer() {
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.status) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

await ensureSdrtopBinConfigured();
await ensureTinySaConfigured();

const server = spawn('npm', ['run', 'dev'], { stdio: 'inherit' });
server.on('exit', (code) => process.exit(code ?? 0));

waitForServer().then(() => openChrome(url));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.kill(signal));
}
