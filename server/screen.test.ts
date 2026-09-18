import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { parseScreen } from './screen.ts';

const require = createRequire(import.meta.url);
const { Terminal } = require('@xterm/headless') as typeof import('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize') as typeof import('@xterm/addon-serialize');

function screen(badge = '○ IDLE', footer = '[Space] RX  [F] Frequency  [S] Span  [Q] Quit') {
  return [
    '┏─╴RADIO╶───────────────────────────────────────────────────────────────────────────────────────┓',
    `│ tinySA Ultra ZS405   ${badge}    tinySA fw 1.4                  USB —                           │`,
    '├────1M──────────────────────────────────────────────────────────────────────────────────6G────┤',
    '│  8 6 8 . 4 0 0 MHz    SPAN  2.0 MHz                                                           │',
    '┗─────────────────────────────────────────────────────────────────────────────────────────────┛',
    '┏─╴WATERFALL╶───────────────────────────────────────────────────────────────────────────────────┓',
    '│                                                                                             │',
    '┗─────────────────────────────────────────────────────────────────────────────────────────────┛',
    '┏─╴LOG╶─────────────────────────────────────────────────────────────────────────────────────────┓',
    '│· 11:23:45  Preset: waterfall                                                                  │',
    '│● 11:23:46  Power trace acquisition started                                                    │',
    '┗─────────────────────────────────────────────────────────────────────────────────────────────┛',
    footer,
  ].join('\n');
}

test('uses the hardware badge and spaced VFO digits', () => {
  const idle = parseScreen(screen());
  assert.equal(idle.rx, 'stopped');
  assert.equal(idle.device, 'tinySA Ultra ZS405');
  assert.equal(idle.frequencyMHz, 868.4);
  assert.equal(idle.spanMHz, 2);
  assert.equal(idle.waterfall, true);
  assert.equal(idle.focused, false);
  assert.equal(parseScreen(screen('● RX')).rx, 'receiving');
});

test('never infers RX from log history, footer hints, or the startup menu', () => {
  assert.equal(parseScreen('Power trace acquisition started\n[Space] RX').rx, 'unknown');
  assert.equal(parseScreen(screen('◈ OBSERVER')).rx, 'unknown');
  const menu = parseScreen('┏ sdrtop 0.4.1 ┓\ntinySA Ultra 868.400 MHz\nCommand Rail\n3 Waterfall\n Tab section  ↑↓ move  1-9 open  Enter open  Esc close');
  assert.equal(menu.menu, true);
  assert.equal(menu.waterfall, false);
  assert.equal(menu.rx, 'unknown');
});

test('matches live input prompts and device failures', () => {
  assert.equal(parseScreen(screen('○ IDLE', 'Frequency (MHz): [▌]  [Enter] Confirm [Esc] Cancel')).prompt, 'frequency');
  assert.equal(parseScreen(screen('○ IDLE', 'Span (0.1–6000.0 MHz): [▌] [Enter] Confirm [Esc] Cancel')).prompt, 'span');
  assert.equal(parseScreen(screen() + '\n│● 11:23:47  Error starting power trace acquisition: tinySA disconnected│').errors.length, 1);
  assert.equal(parseScreen('┏─╴WATERFALL╶──┓\n[↑ ↓] Zoom colour scale').focused, true);
  assert.equal(parseScreen(screen().replace('╴WATERFALL╶', '╴SPECTRUM╶')).waterfall, false);
});

test('headless ANSI parsing and snapshot restoration preserve the screen', async () => {
  const source = new Terminal({ cols: 112, rows: 32, allowProposedApi: true, scrollback: 200 });
  const restored = new Terminal({ cols: 112, rows: 32, allowProposedApi: true, scrollback: 200 });
  const serializer = new SerializeAddon();
  source.loadAddon(serializer);
  const write = (terminal: typeof source, data: string) => new Promise<void>((done) => terminal.write(data, done));
  const text = (terminal: typeof source) => Array.from({ length: 32 }, (_, i) =>
    terminal.buffer.active.getLine(terminal.buffer.active.baseY + i)?.translateToString(true) ?? '').join('\n');
  try {
    await write(source, '\x1b[?1049h\x1b[2J\x1b[H' + screen().replaceAll('\n', '\r\n'));
    await write(source, '\x1b[2;1H\x1b[2K│ tinySA Ultra ZS405   \x1b[32m● RX\x1b[0m   tinySA fw 1.4 │');
    assert.equal(parseScreen(text(source)).rx, 'receiving');
    await write(restored, serializer.serialize({ scrollback: 200 }));
    assert.equal(text(restored), text(source));
    assert.deepEqual(parseScreen(text(restored)), parseScreen(text(source)));
  } finally {
    source.dispose();
    restored.dispose();
  }
});
