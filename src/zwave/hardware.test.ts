import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { HardwareRuntime, type HardwareDependencies } from "./hardware";
import { requiredRegion, requiredRcpChannels, requiredZnifferChannels, requiredZnifferRegion } from "./radio-config";

class FakeInstance extends EventEmitter {
  active = false;
  destroyed = false;
  controller = { ownNodeId: 1, homeId: 0x12345678, nodes: new Map(), async getRFRegion() { return requiredRegion; } };
  currentFrequency = requiredZnifferRegion;
  currentLRChannelConfig = requiredZnifferChannels;
  supportedFrequencies = new Map([[requiredZnifferRegion, "EU Long Range"]]);
  supportedLRChannelConfigs = new Map([[requiredZnifferChannels, "Classic + LR A"]]);
  async queryRegion() { return { region: requiredRegion, channelConfig: requiredRcpChannels, channels: [] }; }
  async start() { this.active = true; }
  async init() {}
  async stop() { this.active = false; }
  async destroy() { this.destroyed = true; }
}

async function driverReady(instance: FakeInstance) {
  instance.emit("driver ready");
  await new Promise<void>(resolve => setImmediate(resolve));
}

function setup() {
  const instances: FakeInstance[] = [];
  const cachePaths: string[] = [];
  const securityOptions: unknown[] = [];
  const opened: number[] = [];
  let closes = 0;
  let picks = 0;
  let loaded = 0;
  const fakePort = {
    readable: null as object | null,
    writable: null as object | null,
    getInfo: () => ({ usbVendorId: 1 }),
    async open(options: SerialOptions) { opened.push(options.baudRate); this.readable = {}; this.writable = {}; },
    async close() { closes++; this.readable = null; this.writable = null; },
  };
  const port = fakePort as unknown as SerialPort;
  let selected = port;
  const serial = new EventTarget() as Serial;
  serial.requestPort = () => { picks++; return Promise.resolve(selected); };
  const create = (_port: SerialPort, cachePath?: string, security?: unknown) => {
    const instance = new FakeInstance();
    instances.push(instance);
    if (cachePath) cachePaths.push(cachePath);
    securityOptions.push(security);
    return instance;
  };
  const hardware = new HardwareRuntime({
    serial: () => serial,
    load: async () => {
      loaded++;
      return {
        createMain: create,
        createZniffer: (port: SerialPort, security: unknown) => create(port, undefined, security),
        createRcp: create,
      } as unknown as Awaited<ReturnType<HardwareDependencies["load"]>>;
    },
  });
  return {
    hardware, port, instances, cachePaths, opened, securityOptions,
    select: (other: SerialPort) => { selected = other; },
    counts: () => ({ closes, picks, loaded }),
  };
}

test("the picker runs in the user gesture before loading packages or opening the port", async () => {
  const { hardware, counts, opened } = setup();
  assert.equal(hardware.getSnapshot().connections.length, 0);
  const operation = hardware.requestConnection("main");
  assert.deepEqual(counts(), { closes: 0, picks: 1, loaded: 0 });
  assert.deepEqual(opened, []);
  await operation;
  assert.equal(hardware.getSnapshot().connections[0].status, "interviewing");
  assert.equal(hardware.getMainDriver(), undefined);
});

test("driver readiness and node readiness remain separate", async () => {
  const { hardware, instances } = setup();
  await hardware.requestConnection("main");
  const node = Object.assign(new EventEmitter(), { id: 2, ready: false });
  instances[0].controller.nodes.set(2, node);
  await driverReady(instances[0]);
  assert.equal(hardware.getMainDriver(), instances[0]);
  assert.deepEqual(hardware.getSnapshot().connections[0].nodes, [{ id: 2, ready: false, interviewing: true, error: undefined }]);
  node.ready = true;
  node.emit("ready");
  assert.deepEqual(hardware.getSnapshot().connections[0].nodes, [{ id: 2, ready: true, interviewing: false, error: undefined }]);
});

test("re-interview all schedules every device but preserves running interviews", async () => {
  const { hardware, instances } = setup();
  await hardware.requestConnection("main");
  const requested: number[] = [];
  for (const id of [1, 2, 3, 256, 4]) {
    const node = Object.assign(new EventEmitter(), {
      id, ready: id !== 4,
      async refreshInfo(options: { waitForWakeup: boolean }) {
        assert.deepEqual(options, { waitForWakeup: false });
        requested.push(id);
        node.ready = false;
        node.emit("interview started", node);
      },
    });
    instances[0].controller.nodes.set(id, node);
  }
  await driverReady(instances[0]);
  assert.deepEqual(await hardware.reinterviewAll(), { requested: [2, 3, 256], inProgress: [4] });
  assert.deepEqual(requested, [2, 3, 256]);
  assert.equal(hardware.getSnapshot().mainBusy, false);
  assert.ok(hardware.getSnapshot().connections[0].nodes.filter(node => node.id !== 1).every(node => node.interviewing && !node.ready));
  assert.deepEqual(await hardware.reinterviewAll(), { requested: [], inProgress: [2, 3, 256, 4] });
  const node = instances[0].controller.nodes.get(2);
  node.emit("interview failed", node, { isFinal: true, errorMessage: "Node did not respond" });
  assert.equal(hardware.getSnapshot().connections[0].nodes.find(node => node.id === 2)?.error, "Node did not respond");
  assert.deepEqual(await hardware.reinterviewAll(), { requested: [2], inProgress: [3, 256, 4] });
  node.ready = true;
  node.emit("ready", node);
  assert.deepEqual(hardware.getSnapshot().connections[0].nodes.find(node => node.id === 2), {
    id: 2, ready: true, interviewing: false, error: undefined,
  });
});

test("re-interview scheduling holds the controller lease and reports per-node failures", async () => {
  const { hardware, instances } = setup();
  await hardware.requestConnection("main");
  let fail!: (error: Error) => void;
  instances[0].controller.nodes.set(2, Object.assign(new EventEmitter(), {
    id: 2, ready: true, refreshInfo: () => new Promise<void>((_resolve, reject) => { fail = reject; }),
  }));
  await driverReady(instances[0]);
  const interview = hardware.reinterviewAll();
  assert.equal(hardware.getSnapshot().mainBusy, true);
  await assert.rejects(hardware.reinterviewAll(), /already running/);
  await assert.rejects(hardware.disconnect("main"), /operation/);
  fail(new Error("Cannot refresh"));
  await assert.rejects(interview, /Node 2: Cannot refresh/);
  assert.equal(hardware.getSnapshot().mainBusy, false);
  assert.equal(hardware.getSnapshot().connections[0].nodes[0].interviewing, false);
  assert.equal(hardware.getSnapshot().connections[0].nodes[0].error, "Node 2: Cannot refresh");
});

test("the main connection rejects a controller other than node 1", async () => {
  const { hardware, instances } = setup();
  await hardware.requestConnection("main");
  instances[0].controller.ownNodeId = 4;
  await driverReady(instances[0]);
  assert.equal(hardware.getSnapshot().connections[0].status, "error");
  assert.equal(hardware.getSnapshot().connections[0].hasInstance, true);
  assert.equal(hardware.getMainDriver(), undefined);
});

test("one SerialPort cannot be assigned to two roles", async () => {
  const { hardware, opened, instances } = setup();
  await hardware.requestConnection("main");
  await assert.rejects(hardware.requestConnection("zniffer"), /already assigned/);
  assert.deepEqual(opened, [115200]);
  assert.equal(instances[0].destroyed, false);
});

test("disconnect releases ownership and reconnect reuses the selected port and isolated cache", async () => {
  const { hardware, counts, opened, cachePaths, instances } = setup();
  await hardware.requestConnection("rcp", "left");
  assert.equal(hardware.getRcpHost("left"), instances[0]);
  await hardware.disconnect("rcp", "left");
  assert.equal(instances[0].destroyed, true);
  await hardware.reconnect("rcp", "left");
  assert.deepEqual(counts(), { closes: 1, picks: 1, loaded: 2 });
  assert.deepEqual(opened, [460800, 460800]);
  assert.deepEqual(cachePaths, ["/zwave-cache/rcp/left", "/zwave-cache/rcp/left"]);
});

test("Zniffer initializes and captures until explicitly stopped", async () => {
  const { hardware, instances } = setup();
  const seen: unknown[] = [];
  const unsubscribe = hardware.subscribeFrames(frame => seen.push(frame));
  await hardware.requestConnection("zniffer");
  assert.equal(hardware.getSnapshot().connections[0].capturing, true);
  instances[0].emit("frame", { sourceNodeId: 2 }, new Uint8Array([1]));
  assert.equal(seen.length, 1);
  unsubscribe();
  instances[0].emit("frame", {}, new Uint8Array());
  assert.equal(seen.length, 1);
  await hardware.setCapture(false);
  assert.equal(hardware.getSnapshot().connections[0].capturing, false);
  await hardware.disconnect("zniffer");
  assert.equal(instances[0].destroyed, true);
});

test("setup can suppress all capture forwarding without stopping the Zniffer or replaying frames", async () => {
  const { hardware, instances } = setup();
  const frames: unknown[] = [];
  const corrupt: unknown[] = [];
  const combined: unknown[] = [];
  hardware.subscribeFrames(frame => frames.push(frame));
  hardware.subscribeCorruptedFrames(frame => corrupt.push(frame));
  hardware.onCapture(event => combined.push(event));
  hardware.setCaptureForwarding(false);
  await hardware.requestConnection("zniffer");
  const emit = () => {
    instances[0].emit("frame", { sourceNodeId: 2 }, new Uint8Array([1]));
    instances[0].emit("corrupted frame", { error: "Checksum" }, new Uint8Array([2]));
  };
  emit();
  assert.deepEqual([frames.length, corrupt.length, combined.length], [0, 0, 0]);
  assert.equal(instances[0].active, true);
  hardware.setCaptureForwarding(true);
  assert.deepEqual([frames.length, corrupt.length, combined.length], [0, 0, 0]);
  emit();
  assert.deepEqual([frames.length, corrupt.length, combined.length], [1, 1, 2]);
  hardware.setCaptureForwarding(false);
  emit();
  assert.deepEqual([frames.length, corrupt.length, combined.length], [1, 1, 2]);
  assert.equal(hardware.getSnapshot().connections[0].capturing, true);
});

test("failed port opens release ownership for a subsequent role", async () => {
  const { hardware, port } = setup();
  const original = port.open;
  port.open = async () => { throw new Error("Port busy"); };
  await assert.rejects(hardware.requestConnection("main"), /Port busy/);
  assert.match(hardware.getSnapshot().connections[0].error!, /Port busy/);
  port.open = original;
  await hardware.requestConnection("zniffer");
  assert.equal(hardware.getSnapshot().connections[1].status, "ready");
});

test("permission cancellation never loads or opens hardware", async () => {
  const hardware = new HardwareRuntime({
    serial: () => ({ requestPort: () => Promise.reject(new Error("No port selected")), addEventListener() {} }) as unknown as Serial,
    load: async () => { throw new Error("must not load"); },
  });
  await assert.rejects(hardware.requestConnection("main"), /No port selected/);
  assert.equal(hardware.getSnapshot().connections[0].status, "error");
});

test("disconnect during permission selection cannot open the selected port", async () => {
  const { port } = setup();
  let select!: (port: SerialPort) => void;
  const selection = new Promise<SerialPort>(resolve => { select = resolve; });
  let loaded = false;
  const hardware = new HardwareRuntime({
    serial: () => ({ requestPort: () => selection, addEventListener() {} }) as unknown as Serial,
    load: async () => { loaded = true; throw new Error("must not load"); },
  });

  const connecting = hardware.requestConnection("main");
  const disconnecting = hardware.disconnect("main");
  select(port);
  await Promise.all([connecting, disconnecting]);
  assert.equal(loaded, false);
  assert.equal(hardware.getSnapshot().connections[0].status, "disconnected");
});

test("disconnect is shared and blocks reconnect until destruction finishes", async () => {
  const { hardware, instances, counts } = setup();
  await hardware.requestConnection("main");
  let finish!: () => void;
  instances[0].destroy = () => new Promise<void>(resolve => { finish = resolve; });
  const first = hardware.disconnect("main");
  const second = hardware.disconnect("main");
  assert.equal(first, second);
  await new Promise(resolve => setTimeout(resolve, 0));
  await assert.rejects(hardware.reconnect("main"), /Disconnect/);
  finish();
  await first;
  assert.equal(counts().closes, 1);
});

test("Zniffer forwards corrupted captures and errors across reconnects", async () => {
  const { hardware, instances } = setup();
  const frames: unknown[] = [];
  const errors: Error[] = [];
  const captures: string[] = [];
  const offCapture = hardware.onCapture(event => captures.push(event.type));
  const offFrames = hardware.subscribeCorruptedFrames(frame => frames.push(frame));
  const offErrors = hardware.subscribeZnifferErrors(error => errors.push(error));
  await hardware.requestConnection("zniffer");
  const corrupted = { error: "CRC mismatch" };
  const error = new Error("Receive failed");
  instances[0].emit("frame", {}, new Uint8Array([1]));
  instances[0].emit("corrupted frame", corrupted, new Uint8Array([1]));
  instances[0].emit("error", error);
  await hardware.disconnect("zniffer");
  await hardware.reconnect("zniffer");
  instances[0].emit("corrupted frame", corrupted, new Uint8Array([1]));
  instances[1].emit("corrupted frame", corrupted, new Uint8Array([1]));
  assert.deepEqual(frames, [corrupted, corrupted]);
  assert.deepEqual(errors, [error]);
  assert.deepEqual(captures, ["frame", "corrupted", "corrupted"]);
  offCapture();
  offFrames();
  offErrors();
  instances[1].emit("corrupted frame", corrupted, new Uint8Array([1]));
  instances[1].emit("error", error);
  assert.equal(frames.length, 2);
  assert.equal(errors.length, 1);
  assert.equal(captures.length, 3);
});

test("main operation lease blocks disconnect and overlapping commands until released", async () => {
  const { hardware, instances } = setup();
  assert.throws(() => hardware.acquireMainOperation(), /ready/);
  await hardware.requestConnection("main");
  await driverReady(instances[0]);
  const lease = hardware.acquireMainOperation();
  assert.equal(lease.driver, instances[0]);
  assert.equal(hardware.getSnapshot().mainBusy, true);
  assert.throws(() => hardware.acquireMainOperation(), /already running/);
  await assert.rejects(hardware.disconnect("main"), /route cleanup/);
  assert.equal(instances[0].destroyed, false);
  lease.release();
  lease.release();
  assert.equal(hardware.getSnapshot().mainBusy, false);
  await hardware.disconnect("main");
  assert.equal(instances[0].destroyed, true);
});

test("existing security keys are copied into the runtime without entering snapshots", async () => {
  const { hardware, securityOptions } = setup();
  const s0 = new Uint8Array(16).fill(0x12);
  const lr = new Uint8Array(16).fill(0x34);
  hardware.configureSecurity({ securityKeys: { S0_Legacy: s0 }, securityKeysLongRange: { S2_Authenticated: lr } });
  assert.deepEqual(hardware.getSnapshot().configuredSecurityKeys, ["S0_Legacy", "LR:S2_Authenticated"]);
  s0.fill(0);
  await hardware.requestConnection("main");
  assert.deepEqual(securityOptions[0], {
    securityKeys: { S0_Legacy: new Uint8Array(16).fill(0x12) },
    securityKeysLongRange: { S2_Authenticated: new Uint8Array(16).fill(0x34) },
  });
  assert.throws(() => hardware.configureSecurity({}), /Disconnect/);
  await hardware.disconnect("main");
  hardware.configureSecurity({});
  assert.deepEqual(hardware.getSnapshot().configuredSecurityKeys, []);
  assert.throws(() => hardware.configureSecurity({ securityKeys: { S0_Legacy: new Uint8Array(4) } }), /16-byte/);
});

test("driver errors revoke readiness and remain latched through node refreshes", async () => {
  const { hardware, instances } = setup();
  await hardware.requestConnection("main");
  const node = Object.assign(new EventEmitter(), { id: 2, ready: false });
  instances[0].controller.nodes.set(2, node);
  await driverReady(instances[0]);
  instances[0].emit("error", new Error("Controller stopped responding"));
  node.ready = true;
  node.emit("ready");
  assert.equal(hardware.getMainDriver(), undefined);
  assert.equal(hardware.getSnapshot().connections[0].status, "error");
  assert.equal(hardware.getSnapshot().connections[0].hasInstance, true);
  assert.equal(hardware.getSnapshot().connections[0].error, "Controller stopped responding");
  hardware.clearError("main");
  node.emit("ready");
  assert.equal(hardware.getMainDriver(), undefined);
  await hardware.disconnect("main");
  assert.equal(hardware.getSnapshot().connections[0].hasInstance, false);
});

test("RCP entries can be removed only after disconnecting", async () => {
  const { hardware } = setup();
  await hardware.requestConnection("rcp", "spare");
  assert.throws(() => hardware.removeRcp("spare"), /Disconnect/);
  await hardware.disconnect("rcp", "spare");
  hardware.removeRcp("spare");
  assert.deepEqual(hardware.getSnapshot().connections, []);
  hardware.removeRcp("spare");
});
