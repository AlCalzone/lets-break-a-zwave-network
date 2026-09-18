import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useSyncExternalStore } from 'react';
import { INITIAL_SDR_STATE, type SdrAction, type SdrState, type ServerMessage, type ClientMessage } from './protocol';
import { findWaterfallRegion } from './waterfall';

interface ViewState {
  connected: boolean;
  connecting: boolean;
  state: SdrState;
  localError: string | null;
  sending: boolean;
  waterfallAvailable: boolean;
}

class TerminalStore {
  private listeners = new Set<() => void>();
  private view: ViewState = { connected: false, connecting: false, state: INITIAL_SDR_STATE, localError: null, sending: false, waterfallAvailable: false };
  private socket: WebSocket | null = null;
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private host: HTMLDivElement | null = null;
  private started = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private request = '';
  private requestTimer: ReturnType<typeof setTimeout> | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSize = '';
  private waterfallOnly = false;
  private hiddenRows = 0;
  draft = { port: '', frequencyMHz: '', spanMHz: '', input: 'auto' as 'auto' | 'low' | 'high' };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.view;

  private update(patch: Partial<ViewState>) {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener();
  }

  ensure() {
    if (this.started) return;
    this.started = true;
    this.terminal = new Terminal({
      cols: 112, rows: 32, scrollback: 200, disableStdin: true,
      convertEol: false, cursorBlink: false, fontSize: 11, lineHeight: 1.08,
      fontFamily: '"IBM Plex Mono", monospace',
      theme: { background: '#080d12', foreground: '#d2dedb', cursor: '#080d12', selectionBackground: '#395e7180' },
    });
    this.terminal.attachCustomKeyEventHandler(() => false);
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.onRender(() => this.crop());
    void this.connect();
  }

  private send(message: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private async connect() {
    if (this.retry) clearTimeout(this.retry);
    this.update({ connecting: true });
    try {
      const response = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(`Local service returned HTTP ${response.status}`);
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/terminal`);
      this.socket = ws;
      ws.onopen = () => {
        if (this.socket !== ws) return;
        this.lastSize = '';
        this.update({ connected: true, connecting: false, localError: null });
      };
      ws.onmessage = (event) => {
        if (this.socket !== ws || typeof event.data !== 'string') return;
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === 'state') {
          const wasPending = this.view.state.pending;
          this.update({ state: message.state });
          if (wasPending && !message.state.pending) this.fit();
          return;
        }
        if (message.type === 'result') {
          if (message.id !== this.request) return;
          if (this.requestTimer) clearTimeout(this.requestTimer);
          this.update({ sending: false, localError: message.error ?? null });
          return;
        }
        if (message.type === 'snapshot') {
          this.terminal!.resize(message.cols, message.rows);
          // Queue the reset with output so a reconnect cannot overtake pending writes
          this.terminal!.write(`\x1bc${message.data}`, () => {
            if (this.socket !== ws) return;
            this.send({ type: 'ack', sequence: message.sequence });
            this.fit();
          });
        } else {
          this.terminal!.write(message.data, () => {
            if (this.socket === ws) this.send({ type: 'ack', sequence: message.sequence });
          });
        }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (this.socket !== ws) return;
        if (this.requestTimer) clearTimeout(this.requestTimer);
        this.update({
          connected: false, connecting: false, sending: false,
          localError: 'Connection lost. Receiver state is unknown until reconnection. Commands will not be replayed.',
        });
        this.retry = setTimeout(() => void this.connect(), 2_000);
      };
    } catch (error) {
      this.update({ connected: false, connecting: false, localError: error instanceof Error ? error.message : String(error) });
      this.retry = setTimeout(() => void this.connect(), 2_000);
    }
  }

  action(command: SdrAction) {
    if (!this.view.connected || this.view.sending || this.view.state.pending) return;
    this.request = crypto.randomUUID();
    this.update({ sending: true, localError: null });
    this.send({ type: 'action', id: this.request, command });
    this.requestTimer = setTimeout(() => {
      this.update({ sending: false, localError: 'No command reply was received. Reconnecting to confirm receiver state.' });
      this.socket?.close();
    }, 50_000);
  }

  private fit() {
    if (!this.host?.isConnected || !this.host.clientWidth || !this.host.clientHeight) return;
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      const dimensions = this.fitAddon?.proposeDimensions();
      if (!dimensions || !this.host?.clientWidth || this.view.state.pending) return;
      const cols = Math.max(80, Math.min(160, dimensions.cols));
      const rows = Math.max(24, Math.min(60, dimensions.rows + (this.waterfallOnly ? this.hiddenRows : 0)));
      const key = `${cols}:${rows}`;
      if (key === this.lastSize) return;
      this.lastSize = key;
      this.terminal?.resize(cols, rows);
      this.send({ type: 'resize', cols, rows });
    }, 180);
  }

  private crop() {
    const terminal = this.terminal;
    const element = terminal?.element;
    const screen = element?.querySelector<HTMLElement>('.xterm-screen');
    if (!terminal || !element || !screen) return;
    if (!this.waterfallOnly) {
      element.style.transform = '';
      element.style.clipPath = '';
      element.style.visibility = '';
      return;
    }
    const buffer = terminal.buffer.active;
    const region = findWaterfallRegion(Array.from({ length: terminal.rows },
      (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? ''));
    if (this.view.waterfallAvailable !== !!region) this.update({ waterfallAvailable: !!region });
    // The cropped terminal must inherit its slide's visibility
    element.style.visibility = region ? '' : 'hidden';
    if (!region) return;
    const cellWidth = parseFloat(screen.style.width) / terminal.cols;
    const cellHeight = parseFloat(screen.style.height) / terminal.rows;
    if (!cellWidth || !cellHeight) return;
    const top = region.top * cellHeight;
    const left = region.left * cellWidth;
    element.style.transform = `translate(${-left}px, ${-top}px)`;
    element.style.clipPath = `inset(${top}px ${(terminal.cols - region.left - region.cols) * cellWidth}px ${(terminal.rows - region.top - region.rows) * cellHeight}px ${left}px)`;
    const hiddenRows = terminal.rows - region.rows;
    if (hiddenRows !== this.hiddenRows) {
      this.hiddenRows = hiddenRows;
      this.fit();
    }
  }

  attach(parent: HTMLDivElement, waterfallOnly = false) {
    this.ensure();
    this.waterfallOnly = waterfallOnly;
    if (!this.host) {
      this.host = document.createElement('div');
      this.host.className = 'sdr-terminal-host';
      parent.append(this.host);
      this.terminal!.open(this.host);
    } else {
      parent.append(this.host);
      this.terminal!.refresh(0, this.terminal!.rows - 1);
    }
    this.host.classList.toggle('is-waterfall', waterfallOnly);
    this.crop();
    const observer = new ResizeObserver(() => this.fit());
    observer.observe(parent);
    void document.fonts.ready.then(() => this.fit());
    this.fit();
    return () => {
      observer.disconnect();
      if (this.host?.parentElement === parent) this.host.remove();
    };
  }
}

export const terminalStore = new TerminalStore();
export function useSdrState() {
  return useSyncExternalStore(terminalStore.subscribe, terminalStore.getSnapshot, terminalStore.getSnapshot);
}
