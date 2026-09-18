import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedHost, allowedOrigin, mhz, validateAction, validateMessage, validateSetup } from './validation.ts';

const setup = { port: '/dev/ttyACM0', frequencyMHz: 868.4, spanMHz: 2 };

test('accepts explicit tinySA setup and numeric tuning', () => {
  assert.deepEqual(validateSetup(setup), { ...setup, input: 'auto' });
  assert.equal(validateSetup({ ...setup, port: '/dev/serial/by-id/usb-tinySA_123-if00', input: 'low' }).input, 'low');
  assert.deepEqual(validateAction({ action: 'frequency', value: 868.4 }), { action: 'frequency', value: 868.4 });
  assert.equal(mhz(1 / 3), 0.333333);
});

test('rejects shell, argument, input, and serial selector injection', () => {
  for (const port of ['/dev/ttyACM0?input=high', '/dev/ttyACM0\nq', '/dev/../etc/passwd', '/etc/passwd', '/dev/null', '/dev/serial/by-id/..']) {
    assert.throws(() => validateSetup({ ...setup, port }), Error, port);
  }
  for (const action of [
    { action: 'launch', setup, executable: '/bin/sh' },
    { action: 'launch', setup: { ...setup, args: ['-c', 'echo no'] } },
    { action: 'input', value: 'q' }, { action: 'rx-start', shell: true },
    { action: 'frequency', value: '868.4\rq' },
  ]) assert.throws(() => validateAction(action));
});

test('rejects invalid numbers and bounds terminal dimensions', () => {
  for (const value of [NaN, Infinity, -1, 0, 12_001, null, '1']) assert.throws(() => mhz(value));
  assert.deepEqual(validateMessage({ type: 'resize', cols: 112, rows: 32 }), { type: 'resize', cols: 112, rows: 32 });
  for (const [cols, rows] of [[79, 32], [161, 32], [112, 23], [112, 61], [112.5, 32]]) {
    assert.throws(() => validateMessage({ type: 'resize', cols, rows }));
  }
  assert.throws(() => validateMessage({ type: 'ack', sequence: -1 }));
  assert.throws(() => validateMessage({ type: 'action', id: 'x\n', command: { action: 'quit' } }));
});

test('requires exact loopback host and matching websocket origin', () => {
  assert.ok(allowedHost('127.0.0.1:5173', 5173));
  assert.ok(allowedHost('localhost:5173', 5173));
  for (const host of ['localhost.evil:5173', 'example.com:5173', '127.0.0.1:5174', undefined]) {
    assert.equal(allowedHost(host, 5173), false);
  }
  assert.ok(allowedOrigin('http://localhost:5173', 'localhost:5173', 5173));
  for (const origin of ['null', 'http://evil.test', 'https://localhost:5173', undefined]) {
    assert.equal(allowedOrigin(origin, 'localhost:5173', 5173), false);
  }
});
