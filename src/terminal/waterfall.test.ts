import assert from 'node:assert/strict';
import test from 'node:test';
import { findWaterfallRegion } from './waterfall';

test('crops the complete waterfall frame including its stale indicator', () => {
  assert.deepEqual(findWaterfallRegion([
    '┏╴RADIO╶───────────────┓',
    '┗─────────────────────┛',
    '┏╴WATERFALL╶ [STALE]──┓',
    '│ Waiting for RX…     │',
    '│                     │',
    '┗─────────────────────┛',
    '┏╴LOG╶────────────────┓',
  ]), { top: 2, left: 0, rows: 4, cols: 23 });
});

test('handles moved and resized waterfall frames', () => {
  assert.deepEqual(findWaterfallRegion([
    '',
    '  ┌╴WATERFALL╶───┐',
    '  │              │',
    '  └──────────────┘',
  ]), { top: 1, left: 2, rows: 3, cols: 16 });
});

test('hides incomplete frames, menus, and log mentions', () => {
  for (const lines of [
    [],
    ['Select Waterfall'],
    ['│ Preset: waterfall │'],
    ['┏╴WATERFALL╶───┓', '│              │'],
    ['┏╴WATERFALL╶───┓', '│              │', ' ┗──────────────┛'],
    ['┏╴WATERFALL╶───┓', '│              │', '┗─────────────┛'],
  ]) assert.equal(findWaterfallRegion(lines), null);
});

test('does not include a following log panel when the waterfall is incomplete', () => {
  assert.equal(findWaterfallRegion([
    '┏╴WATERFALL╶───┓',
    '│              │',
    '┏╴LOG╶─────────┓',
    '│              │',
    '┗──────────────┛',
  ]), null);
});
