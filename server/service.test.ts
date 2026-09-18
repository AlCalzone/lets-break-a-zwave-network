import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { WebSocket } from 'ws';
import { isolatedStateDirectory } from './test-storage.ts';

async function freePort() {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((done) => reservation.close(() => done()));
  return port;
}

function service(t: TestContext, stateDirectory: string, port: number) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), SDRTOP_STATE_DIR: stateDirectory,
      SDRTOP_BIN: `${stateDirectory}/sdrtop-must-not-run` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const clients: WebSocket[] = [];
  t.after(async () => {
    for (const client of clients) client.terminate();
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 7_000);
      await exited;
      clearTimeout(force);
    }
  });
  let stderr = '';
  child.stderr.on('data', (data) => { stderr = (stderr + String(data)).slice(-8_000); });
  return { child, clients, get stderr() { return stderr; } };
}

async function listening(child: ReturnType<typeof service>['child']) {
  await new Promise<void>((done, fail) => {
    child.once('error', fail);
    child.once('exit', () => fail(new Error('Service exited before startup')));
    child.stdout.on('data', (data) => { if (String(data).includes('Presentation:')) done(); });
  });
}

test('loopback service authenticates output and rejects raw input without starting hardware', { timeout: 20_000 }, async (t) => {
  const stateDirectory = isolatedStateDirectory(t);
  const port = await freePort();
  const { child, clients } = service(t, stateDirectory, port);
  await listening(child);
  const base = `http://127.0.0.1:${port}`;
  const badHost = await new Promise<number | undefined>((done, fail) => {
    const req = request(base, { headers: { Host: `attacker.test:${port}` } }, (res) => { res.resume(); done(res.statusCode); });
    req.on('error', fail);
    req.end();
  });
  assert.equal(badHost, 403);
  assert.equal((await fetch(`${base}/api/session`, { headers: { Origin: 'https://attacker.test' } })).status, 403);
  assert.equal((await fetch(`${base}/api/session`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await fetch(`${base}/api/private`)).status, 401);
  const bootstrap = await fetch(`${base}/api/session`);
  assert.equal((await bootstrap.json()).state.process, 'idle');
  const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0];
  const rejected = new WebSocket(`ws://127.0.0.1:${port}/api/terminal`, { origin: base });
  clients.push(rejected);
  rejected.on('error', () => {});
  await new Promise<void>((done) => rejected.on('unexpected-response', (_req, res) => {
    assert.equal(res.statusCode, 403);
    res.resume();
    rejected.terminate();
    done();
  }));
  const client = new WebSocket(`ws://127.0.0.1:${port}/api/terminal`, { origin: base, headers: { Cookie: cookie } });
  clients.push(client);
  const messages: Array<Record<string, any>> = [];
  const next = (type: string) => new Promise<Record<string, any>>((done) => {
    const listener = (raw: Buffer) => {
      const message = JSON.parse(raw.toString());
      messages.push(message);
      if (message.type === type) {
        client.off('message', listener);
        done(message);
      }
    };
    client.on('message', listener);
  });
  assert.equal((await next('state')).state.process, 'idle');
  assert.equal(messages[0].type, 'snapshot');
  const result = next('result');
  client.send(JSON.stringify({
    type: 'action', id: 'missing-device',
    command: { action: 'launch', setup: { port: '/dev/ttyACM999999', frequencyMHz: 868.4, spanMHz: 2 } },
  }));
  assert.match((await result).error, /Serial device is unavailable/);
  const closed = once(client, 'close');
  client.send(JSON.stringify({ type: 'input', data: 'whoami\n' }));
  assert.equal((await closed)[0], 1008);
});

for (const contents of ['{invalid json', JSON.stringify({ port: '/dev/ttyACM999999', frequencyMHz: 868.4, spanMHz: 2 })]) {
  test(`saved startup failure reaches API and reconnects without retries: ${contents}`, { timeout: 20_000 }, async (t) => {
    const directory = isolatedStateDirectory(t);
    await writeFile(resolve(directory, 'setup.json'), contents);
    const port = await freePort();
    const h = service(t, directory, port);
    const failure = once(h.child.stderr, 'data');
    await listening(h.child);
    await failure;
    assert.match(h.stderr, /Receiver startup failed:/);
    const base = `http://127.0.0.1:${port}`;
    const response = await fetch(`${base}/api/session`);
    const state = (await response.json()).state;
    assert.equal(state.process, 'error');
    assert.match(state.error, /Invalid saved receiver setup|Serial device is unavailable/);
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    for (let i = 0; i < 2; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/terminal`, { origin: base, headers: { Cookie: cookie } });
      h.clients.push(ws);
      const received = await new Promise<any>((done, fail) => {
        ws.on('error', fail);
        ws.on('message', (raw) => {
          const message = JSON.parse(raw.toString());
          if (message.type === 'state') done(message.state);
        });
      });
      assert.deepEqual(received, state);
      const closed = once(ws, 'close');
      ws.close();
      await closed;
    }
    assert.equal(h.stderr.match(/Receiver startup failed:/g)?.length, 1);
    assert.equal(await readFile(resolve(directory, 'setup.json'), 'utf8'), contents);
  });
}

test('a listen failure shuts down without attempting receiver restoration', { timeout: 20_000 }, async (t) => {
  const directory = isolatedStateDirectory(t);
  await writeFile(resolve(directory, 'setup.json'), '{invalid json');
  const occupied = createServer();
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  t.after(() => new Promise<void>((done) => occupied.close(() => done())));
  const address = occupied.address();
  assert.ok(address && typeof address !== 'string');
  const h = service(t, directory, address.port);
  const [code] = await once(h.child, 'exit');
  assert.equal(code, 1);
  assert.match(h.stderr, /EADDRINUSE/);
  assert.doesNotMatch(h.stderr, /Receiver startup failed/);
});
