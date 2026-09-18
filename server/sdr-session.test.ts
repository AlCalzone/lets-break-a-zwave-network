import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { type TestContext } from 'node:test';
import type { IPty } from 'node-pty';
import { SdrSession } from './sdr-session.ts';
import { isolatedStateDirectory } from './test-storage.ts';

function frame(rx: 'IDLE' | 'RX', prompt = '', log = 'Preset: waterfall') {
  return '\x1b[2J\x1b[H' + [
    '┏╴RADIO╶━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
    `│ tinySA Ultra ZS405   ○ ${rx}   tinySA fw 1.4`,
    '│',
    '│ 8 6 8 . 4 0 0 MHz    SPAN 2.0 MHz',
    '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛',
    '┏╴WATERFALL╶━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
    '│',
    '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛',
    `● 12:00:01  ${log}`,
    prompt || '[Space] RX [F] Frequency [S] Span',
  ].join('\r\n');
}

function harness(t: TestContext) {
  const session = new SdrSession({ stateDirectory: isolatedStateDirectory(t) });
  const writes: string[] = [];
  let respond: ((text: string) => void) | null = null;
  const child = {
    write: (text: string) => { writes.push(text); respond?.(text); },
    pause() {}, resume() {}, resize() {}, kill() {},
  } as unknown as IPty;
  session['child'] = child;
  session.state.process = 'running';
  const output = (text: string) => session['output'](text, child);
  return {
    session, writes, output,
    respond: (callback: (text: string) => void) => { respond = callback; },
    async show(text: string) { const rendered = once(session, 'screen'); output(text); await rendered; },
    async dispose() { session['child'] = null; await session.shutdown(); },
  };
}

test('separate RX actions observe the badge and never repeat a completed toggle', async (t) => {
  const h = harness(t);
  try {
    await h.show(frame('IDLE'));
    h.respond(() => h.output(frame('RX', '', 'Power trace acquisition started')));
    await h.session.action({ action: 'rx-start' });
    assert.equal(h.session.state.rx, 'receiving');
    assert.equal(h.session.state.ready, true);
    await h.session.action({ action: 'rx-start' });
    assert.deepEqual(h.writes, [' ']);
    h.respond(() => h.output(frame('IDLE', '', 'Power trace acquisition stopped')));
    await h.session.action({ action: 'rx-stop' });
    await h.session.action({ action: 'rx-stop' });
    assert.deepEqual(h.writes, [' ', ' ']);
    assert.equal(h.session.state.requestedRx, 'stopped');
    assert.equal(h.session.state.ready, true);
  } finally { await h.dispose(); }
});

test('frequency input waits for the actual prompt before writing digits', async (t) => {
  const h = harness(t);
  try {
    await h.show(frame('IDLE'));
    h.respond((text) => {
      if (text === 'f') {
        assert.deepEqual(h.writes, ['f']);
        h.output(frame('IDLE', 'Frequency (MHz): [▌] [Enter] Confirm [Esc] Cancel'));
      } else {
        assert.equal(text, '868.4\r');
        h.output(frame('IDLE', '', 'Frequency set to 868.400 MHz'));
      }
    });
    await h.session.action({ action: 'frequency', value: 868.4 });
    assert.deepEqual(h.writes, ['f', '868.4\r']);
    assert.equal(h.session.state.frequencyMHz, 868.4);
  } finally { await h.dispose(); }
});

test('unknown and failed receiver state cannot send another toggle', async (t) => {
  const h = harness(t);
  try {
    await assert.rejects(h.session.action({ action: 'rx-start' }), /not confirmed/);
    assert.equal(h.writes.length, 0);
    await h.show(frame('IDLE'));
    h.respond(() => h.output(frame('IDLE', '', 'Error starting power trace acquisition: tinySA disconnected')));
    await assert.rejects(h.session.action({ action: 'rx-start' }), /Error starting power trace/);
    assert.equal(h.session.state.ready, false);
    await assert.rejects(h.session.action({ action: 'rx-start' }), /not confirmed/);
    assert.deepEqual(h.writes, [' ']);
  } finally { await h.dispose(); }
});
