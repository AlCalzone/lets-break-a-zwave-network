import { EventEmitter } from 'node:events';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { Terminal as HeadlessTerminal } from '@xterm/headless';
import type { SerializeAddon as Serializer } from '@xterm/addon-serialize';
import type { IPty } from 'node-pty';
import { INITIAL_SDR_STATE, type SdrAction, type SdrSetup, type SdrState } from '../src/terminal/protocol.ts';
import { parseScreen, type ScreenState } from './screen.ts';
import { SetupStore } from './setup-store.ts';
import { validateSetup } from './validation.ts';

const require = createRequire(import.meta.url);
const { Terminal } = require('@xterm/headless') as typeof import('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize') as typeof import('@xterm/addon-serialize');
const pty = require('node-pty') as typeof import('node-pty');

interface SessionOptions {
  stateDirectory?: string;
  spawn?: typeof pty.spawn;
  isSerialDevice?: (port: string) => Promise<boolean>;
}

export class SdrSession extends EventEmitter {
  state: SdrState = { ...INITIAL_SDR_STATE };
  terminal: HeadlessTerminal;
  private serializer: Serializer;
  private child: IPty | null = null;
  private screen: ScreenState = parseScreen('');
  private revision = 0;
  private queuedBytes = 0;
  private uncertain = false;
  private disposed = false;
  private stopping = false;
  private startup: Promise<void> | null = null;
  private shutdownTask: Promise<void> | null = null;
  private activeAction: Promise<void> | null = null;
  private store: SetupStore;
  private spawn: typeof pty.spawn;
  private isSerialDevice: (port: string) => Promise<boolean>;
  private pendingSize: { cols: number; rows: number } | null = null;
  sequence = 0;
  cols = 112;
  rows = 32;

  constructor(options: SessionOptions = {}) {
    super();
    this.store = new SetupStore(options.stateDirectory);
    this.spawn = options.spawn ?? pty.spawn;
    this.isSerialDevice = options.isSerialDevice ?? (async (port) => {
      const info = await stat(port).catch(() => null);
      return info?.isCharacterDevice() ?? false;
    });
    this.terminal = new Terminal({ cols: this.cols, rows: this.rows, scrollback: 200, allowProposedApi: true });
    this.serializer = new SerializeAddon();
    this.terminal.loadAddon(this.serializer);
  }

  restore() {
    if (this.startup) return this.startup;
    if (this.stopping) return Promise.resolve();
    this.startup = this.restoreSavedSetup();
    return this.startup;
  }

  private async restoreSavedSetup() {
    this.update({ pending: 'restore' });
    try {
      const setup = await this.store.load();
      this.assertActive();
      if (!setup) return;
      this.update({ setup, pending: null });
      await this.action({ action: 'launch', setup });
      this.assertActive();
      await this.action({ action: 'rx-start' });
      this.update({ notice: 'Saved receiver setup restored. RX is running.' });
    } catch (error) {
      this.update({
        error: error instanceof Error ? error.message : String(error),
        ready: false,
        ...(!this.child ? { process: 'error' as const } : {}),
      });
      throw error;
    } finally {
      if (this.state.pending === 'restore') this.update({ pending: null });
    }
  }

  private assertActive() {
    if (this.stopping) throw new Error('Local service is shutting down');
  }

  private async remember(setup: SdrSetup) {
    await this.store.save(setup);
    this.update({ setup });
  }

  snapshot() {
    return { type: 'snapshot' as const, data: this.serializer.serialize({ scrollback: 200 }), cols: this.cols, rows: this.rows, sequence: this.sequence };
  }

  private update(patch: Partial<SdrState>) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.state);
  }

  private readScreen() {
    const buffer = this.terminal.buffer.active;
    return Array.from({ length: this.rows }, (_, i) => buffer.getLine(buffer.baseY + i)?.translateToString(true) ?? '').join('\n');
  }

  private output(data: string, child: IPty) {
    if (this.disposed) return;
    const bytes = Buffer.byteLength(data);
    this.queuedBytes += bytes;
    if (this.queuedBytes > 128 * 1024) child.pause();
    if (this.queuedBytes > 2 * 1024 * 1024) {
      this.uncertain = true;
      this.update({ error: 'sdrtop output exceeded the parser limit. The process was stopped.', ready: false });
      child.kill('SIGKILL');
    }
    this.terminal.write(data, () => {
      this.queuedBytes -= bytes;
      if (this.disposed) return;
      if (this.child === child && this.queuedBytes < 64 * 1024) child.resume();
      const previousErrors = new Set(this.screen.errors);
      this.screen = parseScreen(this.readScreen());
      this.revision++;
      this.sequence++;
      this.emit('output', { type: 'output', data, sequence: this.sequence });
      if (this.child === child) {
        const error = this.screen.errors.find((line) => !previousErrors.has(line));
        if (error) this.uncertain = true;
        this.update({
          rx: this.screen.rx,
          device: this.screen.device,
          frequencyMHz: this.screen.frequencyMHz,
          spanMHz: this.screen.spanMHz,
          ready: !this.uncertain && !this.screen.menu && !this.screen.prompt && !this.screen.focused &&
            this.screen.waterfall && this.screen.rx !== 'unknown',
          ...(error ? { error: error.trim() } : {}),
        });
      }
      this.emit('screen');
    });
  }

  private waitFor(predicate: (screen: ScreenState) => boolean, after: number, label: string, timeout = 15_000): Promise<void> {
    return new Promise((resolveWait, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.off('screen', check);
        this.off('exit', exited);
        this.off('shutdown', stopped);
        error ? reject(error) : resolveWait();
      };
      const check = () => {
        if (this.stopping) stopped();
        else if (this.uncertain) finish(new Error(this.state.error ?? 'Receiver state is unknown'));
        else if (this.revision > after && predicate(this.screen)) finish();
      };
      const exited = () => finish(new Error(this.state.error ?? 'sdrtop exited'));
      const stopped = () => finish(new Error('Local service is shutting down'));
      const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${label}. No command was retried. Quit and relaunch to recover.`)), timeout);
      this.on('screen', check);
      this.on('exit', exited);
      this.on('shutdown', stopped);
      check();
    });
  }

  private write(text: string) {
    this.assertActive();
    if (!this.child) throw new Error('Launch sdrtop first');
    const before = this.revision;
    this.child.write(text);
    return before;
  }

  private async launch(setup: SdrSetup) {
    setup = validateSetup(setup);
    if (this.child) throw new Error('sdrtop is already running');
    this.update({ setup });
    if (!await this.isSerialDevice(setup.port)) throw new Error(`Serial device is unavailable: ${setup.port}`);
    this.assertActive();
    const directory = this.store.directory;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const config = resolve(directory, 'config.toml');
    await writeFile(config,
      `[radio]\nfrequency_hz = ${Math.round(setup.frequencyMHz * 1e6)}\nsample_rate = ${Math.round(setup.spanMHz * 1e6)}.0\n\n[tinysa]\npoints = 64\nrbw = "300"\n\n[display]\nactive_preset = "waterfall"\nwaterfall_max_rows = 512\n`,
      { mode: 0o600 });
    await new Promise<void>((done) => this.terminal.write('', done));
    this.assertActive();
    this.terminal.reset();
    this.screen = parseScreen('');
    this.uncertain = false;
    this.emit('reset', this.snapshot());
    this.update({ ...INITIAL_SDR_STATE, process: 'starting', setup, pending: 'launch' });
    const device = `tinysa=${setup.port}${setup.input && setup.input !== 'auto' ? `?input=${setup.input}` : ''}`;
    const child = this.spawn(process.env.SDRTOP_BIN || 'sdrtop',
      ['--config', config, '--device', device, '--frequency', String(Math.round(setup.frequencyMHz * 1e6))],
      { name: 'xterm-256color', cols: this.cols, rows: this.rows, cwd: process.cwd(),
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } });
    this.child = child;
    child.onData((data) => this.output(data, child));
    child.onExit(({ exitCode, signal }) => {
      if (this.child !== child) return;
      this.child = null;
      this.update({
        process: 'exited', rx: 'unknown', ready: false, pending: null, requestedRx: null,
        error: this.state.error ?? (exitCode !== 0 ? `sdrtop exited with code ${exitCode}${signal ? ` (signal ${signal})` : ''}. Check the terminal and SDRTOP_BIN.` : null),
      });
      this.emit('exit');
    });
    await this.waitFor((s) => s.menu, this.revision, 'the initial sdrtop menu', 25_000);
    const before = this.write('\r');
    await this.waitFor((s) => !s.menu && s.waterfall && s.rx === 'stopped', before, 'the Waterfall layout with RX stopped');
    this.update({ process: 'running', notice: 'tinySA is connected. RX is stopped. Header values are rounded by sdrtop.' });
    await this.remember(setup);
  }

  async action(command: SdrAction) {
    this.assertActive();
    if (this.state.pending) throw new Error(`Wait for ${this.state.pending} to finish`);
    if (command.action !== 'launch' && command.action !== 'quit' && !this.state.ready) {
      throw new Error('Receiver state is not confirmed. Quit and relaunch before sending controls.');
    }
    const task = this.runAction(command);
    this.activeAction = task;
    try {
      await task;
    } finally {
      if (this.activeAction === task) this.activeAction = null;
    }
  }

  private async runAction(command: SdrAction) {
    this.update({ pending: command.action, error: null, notice: null });
    try {
      switch (command.action) {
        case 'launch':
          await this.launch(command.setup);
          break;
        case 'quit':
          await this.quit();
          break;
        case 'frequency':
        case 'span': {
          const before = this.write(command.action === 'frequency' ? 'f' : 's');
          await this.waitFor((s) => s.prompt === command.action, before, `the ${command.action} prompt`);
          const entered = this.write(`${command.value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}\r`);
          await this.waitFor((s) => s.prompt === null && s.waterfall && s.rx !== 'unknown', entered, `the confirmed ${command.action}`);
          const actual = command.action === 'frequency' ? this.state.frequencyMHz : this.state.spanMHz;
          if (actual === null) throw new Error(`sdrtop did not confirm the ${command.action}`);
          if (this.state.setup) {
            await this.remember({
              ...this.state.setup,
              [command.action === 'frequency' ? 'frequencyMHz' : 'spanMHz']: actual,
            });
          }
          this.update({ notice: `Requested ${command.value} MHz. sdrtop displays ${actual} MHz. The device may clamp or round this value.` });
          break;
        }
        case 'waterfall': {
          const before = this.write('3');
          await this.waitFor((s) => s.waterfall && !s.focused && !s.menu && s.logs.some((line) => line.includes('Preset: waterfall')),
            before, 'the Waterfall layout');
          break;
        }
        case 'rx-start':
        case 'rx-stop': {
          const target = command.action === 'rx-start' ? 'receiving' : 'stopped';
          this.update({ requestedRx: target });
          if (this.screen.rx === target) break;
          if (this.screen.rx === 'unknown') throw new Error('RX state is unknown. No toggle was sent.');
          const before = this.write(' ');
          const log = target === 'receiving' ? 'Power trace acquisition started' : 'Power trace acquisition stopped';
          await this.waitFor((s) => s.rx === target && s.logs.some((line) => line.includes(log)), before, `RX ${target}`);
          break;
        }
      }
    } catch (error) {
      this.uncertain = !!this.child;
      this.update({
        error: error instanceof Error ? error.message : String(error),
        ready: false,
        ...(!this.child && command.action === 'launch' ? { process: 'error' as const } : {}),
      });
      throw error;
    } finally {
      this.update({ pending: null });
      if (this.pendingSize) {
        const { cols, rows } = this.pendingSize;
        this.pendingSize = null;
        this.resize(cols, rows);
      }
    }
  }

  private async quit() {
    const child = this.child;
    if (!child) return;
    this.uncertain = false;
    if (this.screen.prompt && this.stopping) {
      child.write('\x1b');
    } else if (this.screen.prompt) {
      const before = this.write('\x1b');
      await this.waitFor((s) => !s.prompt, before, 'the input prompt to close').catch(() => {});
    }
    await new Promise<void>((resolveQuit) => {
      const timer = setTimeout(() => {
        if (this.child === child) {
          child.kill('SIGKILL');
          this.update({ notice: 'sdrtop did not quit in time. The process was terminated.' });
        }
        cleanup();
      }, 5_000);
      const cleanup = () => {
        clearTimeout(timer);
        this.off('exit', cleanup);
        resolveQuit();
      };
      this.on('exit', cleanup);
      if (this.child === child) child.write('q');
      else cleanup();
    });
  }

  resize(cols: number, rows: number) {
    if (this.stopping) return;
    if (this.state.pending) {
      this.pendingSize = { cols, rows };
      return;
    }
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.terminal.resize(cols, rows);
    this.child?.resize(cols, rows);
    this.emit('reset', this.snapshot());
  }

  shutdown() {
    if (this.shutdownTask) return this.shutdownTask;
    this.stopping = true;
    this.emit('shutdown');
    this.shutdownTask = this.finishShutdown();
    return this.shutdownTask;
  }

  private async finishShutdown() {
    await Promise.allSettled([this.startup, this.activeAction]);
    await this.quit();
    this.disposed = true;
    this.terminal.dispose();
  }
}
