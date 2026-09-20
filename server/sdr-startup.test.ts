import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { IPty } from 'node-pty';
import type { SdrSetup } from '../src/terminal/protocol.ts';
import { SdrSession } from './sdr-session.ts';
import { SetupStore } from './setup-store.ts';
import { isolatedStateDirectory } from './test-storage.ts';

const setup: SdrSetup = { port: '/dev/ttyACM0', frequencyMHz: 868.4, spanMHz: 2, input: 'high' };

function frame(rx = 'IDLE', frequency = 868.4, span = 2, prompt = '', log = 'Preset: waterfall') {
  return '\x1b[2J\x1b[H' + [
    '┏╴RADIO╶━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
    `│ tinySA Ultra ZS405   ○ ${rx}   tinySA fw 1.4`,
    '│',
    `│ ${frequency.toFixed(3)} MHz    SPAN ${span.toFixed(1)} MHz`,
    '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛',
    '┏╴WATERFALL╶━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
    `● 12:00:01  ${log}`,
    prompt || '[Space] RX [F] Frequency [S] Span',
  ].join('\r\n');
}

function receiver(t: TestContext, options: {
  directory?: string;
  isSerialDevice?: (port: string) => Promise<boolean>;
  spawnError?: string;
  launchError?: boolean;
  holdMenu?: boolean;
} = {}) {
  const directory = options.directory ?? isolatedStateDirectory(t);
  const writes: string[] = [];
  const launches: { file: string; args: string[] }[] = [];
  let output = (_text: string) => {};
  let exit = (_event: { exitCode: number }) => {};
  let rx = 'IDLE';
  let frequency = setup.frequencyMHz;
  let span = setup.spanMHz;
  let prompt: 'frequency' | 'span' | null = null;
  const h = {
    frequencyAfterTuning: 899.9, spanAfterTuning: 1.5, failTuning: false, failRx: false,
    directory, writes, launches,
    output: (text: string) => output(text),
  };
  const child = {
    onData(callback: typeof output) {
      output = callback;
      if (!options.holdMenu) setImmediate(() => output(options.launchError
        ? frame('IDLE', frequency, span, '', 'Error: tinySA disconnected')
        : '\x1b[2J\x1b[Hsdrtop\r\nEnter open   Tab section'));
      return { dispose() {} };
    },
    onExit(callback: typeof exit) { exit = callback; return { dispose() {} }; },
    write(text: string) {
      writes.push(text);
      if (text === 'q') { exit({ exitCode: 0 }); return; }
      if (text === 'f' || text === 's') {
        prompt = text === 'f' ? 'frequency' : 'span';
        output(frame(rx, frequency, span, prompt === 'frequency' ? 'Frequency (MHz): [▌]' : 'Span (MHz): [▌]'));
        return;
      }
      if (prompt) {
        if (h.failTuning) { output(frame(rx, frequency, span, '', 'Error: invalid frequency')); return; }
        if (prompt === 'frequency') frequency = h.frequencyAfterTuning;
        else span = h.spanAfterTuning;
        prompt = null;
      }
      let log = 'Preset: waterfall';
      if (text === ' ') {
        if (h.failRx) { output(frame(rx, frequency, span, '', 'Error starting power trace acquisition')); return; }
        rx = rx === 'IDLE' ? 'RX' : 'IDLE';
        log = `Power trace acquisition ${rx === 'RX' ? 'started' : 'stopped'}`;
      }
      output(frame(rx, frequency, span, '', log));
    },
    pause() {}, resume() {}, resize() {},
    kill() { exit({ exitCode: 1 }); },
  } as unknown as IPty;
  const session = new SdrSession({
    stateDirectory: directory,
    isSerialDevice: options.isSerialDevice ?? (async () => true),
    spawn(file, args) {
      launches.push({ file, args: args as string[] });
      if (options.spawnError) throw new Error(options.spawnError);
      return child;
    },
  });
  t.after(() => session.shutdown());
  return { ...h, session, controls: h };
}

test('manual launch remembers setup and a new session starts RX after the stopped layout', async (t) => {
  const manual = receiver(t);
  await manual.session.action({ action: 'launch', setup });
  assert.deepEqual(manual.writes, ['\r']);
  assert.equal(manual.session.state.rx, 'stopped');
  assert.deepEqual(await new SetupStore(manual.directory).load(), setup);
  assert.equal((await stat(resolve(manual.directory, 'setup.json'))).mode & 0o777, 0o600);
  const config = await readFile(resolve(manual.directory, 'config.toml'), 'utf8');
  assert.match(config, /sample_rate = 2000000.0/);
  assert.match(config, /\[tinysa\]\npoints = 64\nrbw = "300"/);
  assert.match(config, /waterfall_max_rows = 512/);
  await manual.session.shutdown();

  const automatic = receiver(t, { directory: manual.directory });
  const states: string[] = [];
  automatic.session.on('state', (state) => states.push(`${state.process}:${state.rx}`));
  const startup = automatic.session.restore();
  assert.equal(automatic.session.restore(), startup);
  await startup;
  assert.deepEqual(automatic.writes, ['\r', ' ']);
  assert.equal(automatic.session.state.rx, 'receiving');
  assert.equal(automatic.session.state.pending, null);
  assert.ok(states.indexOf('running:stopped') < states.indexOf('running:receiving'));
  assert.deepEqual(automatic.launches[0].args, [
    '--config', resolve(manual.directory, 'config.toml'),
    '--device', 'tinysa=/dev/ttyACM0?input=high', '--frequency', '868400000',
  ]);
});

test('missing saved setup stays idle and restoration is attempted only once', async (t) => {
  let deviceChecks = 0;
  const h = receiver(t, { isSerialDevice: async () => { deviceChecks++; return true; } });
  await h.session.restore();
  assert.equal(h.session.state.process, 'idle');
  assert.equal(h.session.state.pending, null);
  assert.equal(h.session.state.error, null);
  assert.deepEqual(await readdir(h.directory), []);
  await new SetupStore(h.directory).save(setup);
  await h.session.restore();
  assert.equal(deviceChecks, 0);
  assert.equal(h.launches.length, 0);
});

test('confirmed frequency and span changes remember the values displayed by the device', async (t) => {
  const h = receiver(t);
  await h.session.action({ action: 'launch', setup });
  await h.session.action({ action: 'frequency', value: 900 });
  await h.session.action({ action: 'span', value: 1.6 });
  const saved = { ...setup, frequencyMHz: 899.9, spanMHz: 1.5 };
  assert.deepEqual(await new SetupStore(h.directory).load(), saved);
  assert.deepEqual(h.session.state.setup, saved);
  assert.deepEqual((await readdir(h.directory)).sort(), ['config.toml', 'setup.json']);

  h.controls.failTuning = true;
  await assert.rejects(h.session.action({ action: 'frequency', value: 901 }), /invalid frequency/);
  assert.deepEqual(await new SetupStore(h.directory).load(), saved);
});

test('Stop RX and Quit survive further restore calls and snapshots', async (t) => {
  const h = receiver(t);
  await new SetupStore(h.directory).save(setup);
  await h.session.restore();
  await h.session.action({ action: 'rx-stop' });
  h.session.snapshot();
  await h.session.restore();
  assert.equal(h.session.state.rx, 'stopped');
  assert.deepEqual(h.writes, ['\r', ' ', ' ']);
  await h.session.action({ action: 'quit' });
  h.session.snapshot();
  await h.session.restore();
  assert.equal(h.session.state.process, 'exited');
  assert.equal(h.launches.length, 1);
  assert.deepEqual(h.writes, ['\r', ' ', ' ', 'q']);
  assert.deepEqual(await new SetupStore(h.directory).load(), setup);
});

for (const contents of ['{bad json', JSON.stringify({ ...setup, port: '/dev/null' }), JSON.stringify({ ...setup, input: ['auto'] })]) {
  test(`invalid saved setup reports an error without touching hardware: ${contents}`, async (t) => {
    let deviceChecks = 0;
    const h = receiver(t, { isSerialDevice: async () => { deviceChecks++; return true; } });
    await writeFile(resolve(h.directory, 'setup.json'), contents);
    await assert.rejects(h.session.restore(), /Invalid saved receiver setup/);
    assert.equal(h.session.state.process, 'error');
    assert.match(h.session.state.error!, /Invalid saved receiver setup/);
    assert.equal(h.session.state.pending, null);
    assert.equal(deviceChecks, 0);
    assert.equal(h.launches.length, 0);
    await assert.rejects(h.session.restore());
    assert.equal(deviceChecks, 0);
  });
}

test('missing saved device exposes an error without spawning or toggling RX', async (t) => {
  const h = receiver(t, { isSerialDevice: async () => false });
  await new SetupStore(h.directory).save(setup);
  await assert.rejects(h.session.restore(), /Serial device is unavailable/);
  assert.equal(h.session.state.process, 'error');
  assert.match(h.session.state.error!, /Serial device is unavailable/);
  assert.deepEqual(h.session.state.setup, setup);
  assert.equal(h.launches.length, 0);
  assert.deepEqual(h.writes, []);
});

test('missing executable exposes its error and is not retried', async (t) => {
  const h = receiver(t, { spawnError: 'sdrtop executable not found' });
  await new SetupStore(h.directory).save(setup);
  await assert.rejects(h.session.restore(), /executable not found/);
  await assert.rejects(h.session.restore(), /executable not found/);
  assert.equal(h.session.state.process, 'error');
  assert.match(h.session.state.error!, /executable not found/);
  assert.equal(h.launches.length, 1);
  assert.deepEqual(h.writes, []);
});

test('a receiver initialization error prevents automatic RX', async (t) => {
  const h = receiver(t, { launchError: true });
  await new SetupStore(h.directory).save(setup);
  await assert.rejects(h.session.restore(), /tinySA disconnected/);
  assert.equal(h.session.state.ready, false);
  assert.match(h.session.state.error!, /tinySA disconnected/);
  assert.deepEqual(h.writes, []);
});

test('automatic RX failure is reported without retrying the toggle', async (t) => {
  const h = receiver(t);
  h.controls.failRx = true;
  await new SetupStore(h.directory).save(setup);
  await assert.rejects(h.session.restore(), /Error starting power trace/);
  await assert.rejects(h.session.restore(), /Error starting power trace/);
  assert.equal(h.session.state.ready, false);
  assert.deepEqual(h.writes, ['\r', ' ']);
});

test('failed manual launch leaves the saved setup untouched', async (t) => {
  const h = receiver(t, { spawnError: 'missing executable' });
  await new SetupStore(h.directory).save(setup);
  await assert.rejects(h.session.action({ action: 'launch', setup: { ...setup, port: '/dev/ttyACM1' } }));
  assert.deepEqual(await new SetupStore(h.directory).load(), setup);
});

test('a persistence error is visible and leaves no staging files', async (t) => {
  const h = receiver(t);
  await mkdir(resolve(h.directory, 'setup.json'));
  await assert.rejects(h.session.action({ action: 'launch', setup }), /EISDIR/);
  assert.match(h.session.state.error!, /EISDIR/);
  assert.deepEqual(h.writes, ['\r']);
  assert.deepEqual((await readdir(h.directory)).sort(), ['config.toml', 'setup.json']);
});

test('shutdown during saved-device validation prevents a later spawn', async (t) => {
  let release!: () => void;
  let entered!: () => void;
  const checking = new Promise<void>((done) => { entered = done; });
  const blocked = new Promise<void>((done) => { release = done; });
  const h = receiver(t, { isSerialDevice: async () => { entered(); await blocked; return true; } });
  await new SetupStore(h.directory).save(setup);
  const startup = h.session.restore();
  const rejected = assert.rejects(startup, /shutting down/);
  await checking;
  const shutdown = h.session.shutdown();
  release();
  await Promise.all([rejected, shutdown]);
  assert.equal(h.launches.length, 0);
  assert.deepEqual(h.writes, []);
  await assert.rejects(h.session.action({ action: 'launch', setup }), /shutting down/);
});

test('shutdown cancels startup waiting for a menu and quits the owned PTY', async (t) => {
  const h = receiver(t, { holdMenu: true });
  await new SetupStore(h.directory).save(setup);
  const startup = h.session.restore();
  const rejected = assert.rejects(startup, /shutting down/);
  while (h.launches.length === 0) await once(h.session, 'state');
  await h.session.shutdown();
  await rejected;
  assert.equal(h.session.state.process, 'exited');
  assert.deepEqual(h.writes, ['q']);
  assert.equal(h.session.listenerCount('screen'), 0);
});

test('shutdown before restoration never reads setup or launches a process', async (t) => {
  const h = receiver(t);
  await new SetupStore(h.directory).save(setup);
  await h.session.shutdown();
  await h.session.restore();
  assert.equal(h.session.state.process, 'idle');
  assert.equal(h.launches.length, 0);
});
