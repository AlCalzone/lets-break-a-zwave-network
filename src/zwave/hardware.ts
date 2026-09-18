import type { CorruptedFrame, Driver, Frame, Zniffer, ZWaveOptions } from "zwave-js";
import type { RCPHost } from "../../node_modules/zwave-js/build/esm/RCPHost.js";
import type { CaptureEvent } from "./capture";
import { configureRcpRadio, configureZnifferRadio, verifyMainRadio } from "./radio-config";

export type HardwareKind = "main" | "zniffer" | "rcp";
export type HardwareStatus = "disconnected" | "selecting" | "connecting" | "interviewing" | "ready" | "disconnecting" | "error";
export type FrameListener = (frame: Frame, rawData: Uint8Array) => void;
export type CorruptedFrameListener = (frame: CorruptedFrame, rawData: Uint8Array) => void;
export type { CorruptedFrame, Frame, Driver, Zniffer, RCPHost };
export type HardwareSecurityOptions = Pick<ZWaveOptions, "securityKeys" | "securityKeysLongRange">;

export interface HardwareConnection {
  kind: HardwareKind;
  id: string;
  status: HardwareStatus;
  hasInstance: boolean;
  error?: string;
  portInfo?: SerialPortInfo;
  controllerNodeId?: number;
  homeId?: number;
  nodes: readonly { id: number; ready: boolean; interviewing?: boolean; error?: string }[];
  capturing: boolean;
  rfRegion?: number;
  channelConfig?: number;
}
export interface HardwareSnapshot {
  supported: boolean;
  mainBusy: boolean;
  configuredSecurityKeys: readonly string[];
  connections: readonly HardwareConnection[];
}

type Runtime = typeof import("./browser-runtime");
type Instance = Driver | Zniffer | RCPHost;
interface Entry {
  state: HardwareConnection;
  port?: SerialPort;
  instance?: Instance;
  operation?: Promise<void>;
  teardown?: Promise<void>;
  generation: number;
  interviews?: Map<number, { active: boolean; error?: string }>;
}
export interface HardwareDependencies {
  serial: () => Serial | undefined;
  load: () => Promise<Runtime>;
}

export class HardwareRuntime {
  private entries = new Map<string, Entry>();
  private owners = new Map<SerialPort, Entry>();
  private listeners = new Set<() => void>();
  private frameListeners = new Set<FrameListener>();
  private corruptedFrameListeners = new Set<CorruptedFrameListener>();
  private znifferErrorListeners = new Set<(error: Error) => void>();
  private snapshot: HardwareSnapshot;
  private serialWithListener?: Serial;
  private mainBusy = false;
  private security: HardwareSecurityOptions = {};
  private forwardCaptures = true;

  constructor(private dependencies: HardwareDependencies = {
    serial: () => typeof navigator === "undefined" ? undefined : navigator.serial,
    load: () => import("./browser-runtime"),
  }) {
    this.snapshot = { supported: !!dependencies.serial(), mainBusy: false, configuredSecurityKeys: [], connections: [] };
  }

  getSnapshot = (): HardwareSnapshot => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  subscribeFrames = (listener: FrameListener) => {
    this.frameListeners.add(listener);
    return () => { this.frameListeners.delete(listener); };
  };
  subscribeCorruptedFrames = (listener: CorruptedFrameListener) => {
    this.corruptedFrameListeners.add(listener);
    return () => { this.corruptedFrameListeners.delete(listener); };
  };
  subscribeZnifferErrors = (listener: (error: Error) => void) => {
    this.znifferErrorListeners.add(listener);
    return () => { this.znifferErrorListeners.delete(listener); };
  };
  setCaptureForwarding(enabled: boolean) {
    this.forwardCaptures = enabled;
  }
  onCapture = (listener: (event: CaptureEvent) => void) => {
    const offFrames = this.subscribeFrames((frame, rawData) => listener({ type: "frame", frame, rawData }));
    const offCorrupted = this.subscribeCorruptedFrames((frame, rawData) => listener({ type: "corrupted", frame, rawData }));
    return () => { offFrames(); offCorrupted(); };
  };

  private publish(entry: Entry, change: Partial<HardwareConnection>) {
    entry.state = { ...entry.state, ...change, hasInstance: !!entry.instance };
    this.refreshSnapshot();
  }

  private refreshSnapshot() {
    this.snapshot = {
      supported: !!this.dependencies.serial(),
      mainBusy: this.mainBusy,
      configuredSecurityKeys: [
        ...Object.keys(this.security.securityKeys ?? {}),
        ...Object.keys(this.security.securityKeysLongRange ?? {}).map(key => `LR:${key}`),
      ],
      connections: [...this.entries.values()].map(value => value.state),
    };
    for (const listener of this.listeners) listener();
  }

  configureSecurity(options: HardwareSecurityOptions) {
    if (this.mainBusy) throw new Error("Wait for the main-controller operation to finish");
    if ([...this.entries.values()].some(entry =>
      entry.state.kind !== "rcp" && (entry.instance || entry.operation || entry.teardown))) {
      throw new Error("Disconnect the main controller and Zniffer before changing security keys");
    }
    const keys = options.securityKeys ?? {};
    const lrKeys = options.securityKeysLongRange ?? {};
    for (const [name, value] of Object.entries(keys)) {
      if (!["S0_Legacy", "S2_Unauthenticated", "S2_Authenticated", "S2_AccessControl"].includes(name) ||
          !(value instanceof Uint8Array) || value.length !== 16) {
        throw new Error(`${name} must be an existing 16-byte Z-Wave security key`);
      }
    }
    for (const [name, value] of Object.entries(lrKeys)) {
      if (!["S2_Authenticated", "S2_AccessControl"].includes(name) ||
          !(value instanceof Uint8Array) || value.length !== 16) {
        throw new Error(`${name} must be an existing 16-byte Long Range security key`);
      }
    }
    this.security = {
      securityKeys: Object.fromEntries(Object.entries(keys).map(([name, value]) => [name, new Uint8Array(value)])),
      securityKeysLongRange: Object.fromEntries(Object.entries(lrKeys).map(([name, value]) => [name, new Uint8Array(value)])),
    };
    this.refreshSnapshot();
  }

  acquireMainOperation(): { driver: Driver; release: () => void } {
    if (this.mainBusy) throw new Error("A main-controller operation is already running");
    const driver = this.getMainDriver();
    if (!driver) throw new Error("Connect the main controller and wait for it to become ready");
    this.mainBusy = true;
    this.refreshSnapshot();
    let released = false;
    return {
      driver,
      release: () => {
        if (released) return;
        released = true;
        this.mainBusy = false;
        this.refreshSnapshot();
      },
    };
  }

  private refreshMainNodes(entry: Entry, driver: Driver) {
    this.publish(entry, {
      nodes: [...driver.controller.nodes.values()].map(node => {
        const interview = entry.interviews?.get(node.id);
        return {
          id: node.id, ready: node.ready && !interview?.active && !interview?.error,
          interviewing: interview?.active ?? !node.ready, error: interview?.error,
        };
      }),
    });
  }

  async reinterviewAll() {
    const operation = this.acquireMainOperation();
    const entry = this.entry("main");
    const generation = entry.generation;
    const requested: number[] = [];
    const inProgress: number[] = [];
    try {
      const { driver } = operation;
      const nodes = [...driver.controller.nodes.values()].filter(node => node.id !== driver.controller.ownNodeId);
      const results = await Promise.allSettled(nodes.map(async node => {
        if (entry.interviews?.get(node.id)?.active) {
          inProgress.push(node.id);
          return;
        }
        entry.interviews?.set(node.id, { active: true });
        this.refreshMainNodes(entry, driver);
        try {
          await node.refreshInfo({ waitForWakeup: false });
          requested.push(node.id);
        } catch (error) {
          const message = `Node ${node.id}: ${error instanceof Error ? error.message : String(error)}`;
          if (entry.generation === generation) {
            entry.interviews?.set(node.id, { active: false, error: message });
            this.refreshMainNodes(entry, driver);
          }
          throw new Error(message);
        }
      }));
      const failures = results.filter(result => result.status === "rejected");
      if (failures.length) throw new Error(failures.map(result => String(result.reason)).join("\n"));
      return { requested, inProgress };
    } finally {
      operation.release();
    }
  }

  private entry(kind: HardwareKind, id: string = kind): Entry {
    if (kind !== "rcp" && id !== kind) throw new Error(`${kind} has exactly one connection`);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Connection IDs must use letters, numbers, underscores, or hyphens");
    const key = `${kind}:${id}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { state: { kind, id, status: "disconnected", hasInstance: false, nodes: [], capturing: false }, generation: 0 };
      this.entries.set(key, entry);
    }
    return entry;
  }

  /** Call directly from a user gesture to open the browser's serial picker. */
  requestConnection(kind: HardwareKind, id?: string): Promise<void> {
    if (kind === "main" && this.mainBusy) return Promise.reject(new Error("Wait for the main-controller operation to finish"));
    const entry = this.entry(kind, id);
    if (entry.operation || entry.teardown || entry.instance) return Promise.reject(new Error("Disconnect this connection before choosing another port"));
    const serial = this.dependencies.serial();
    if (!serial) {
      const error = new Error("Web Serial requires Chrome or Edge on HTTPS or localhost");
      this.publish(entry, { status: "error", error: error.message });
      return Promise.reject(error);
    }
    this.watchDisconnects(serial);
    const selection = serial.requestPort();
    this.publish(entry, { status: "selecting", error: undefined });
    return this.begin(entry, selection);
  }

  reconnect(kind: HardwareKind, id?: string): Promise<void> {
    if (kind === "main" && this.mainBusy) return Promise.reject(new Error("Wait for the main-controller operation to finish"));
    const entry = this.entry(kind, id);
    if (entry.operation || entry.teardown || entry.instance) return Promise.reject(new Error("Disconnect this connection before reconnecting"));
    if (!entry.port) return Promise.reject(new Error("Choose a serial port first"));
    this.publish(entry, { status: "connecting", error: undefined });
    return this.begin(entry, Promise.resolve(entry.port));
  }

  private begin(entry: Entry, selection: Promise<SerialPort>) {
    const generation = ++entry.generation;
    const operation = this.connect(entry, selection, generation);
    entry.operation = operation;
    void operation.finally(() => {
      if (entry.operation === operation) entry.operation = undefined;
    }).catch(() => {});
    return operation;
  }

  private async connect(entry: Entry, selection: Promise<SerialPort>, generation: number) {
    try {
      const port = await selection;
      if (generation !== entry.generation) return;
      const owner = this.owners.get(port);
      if (owner && owner !== entry) throw new Error(`This port is already assigned to ${owner.state.kind} ${owner.state.id}`);
      this.owners.set(port, entry);
      entry.port = port;
      this.publish(entry, { status: "connecting", portInfo: port.getInfo(), nodes: [], capturing: false, rfRegion: undefined, channelConfig: undefined });
      const runtime = await this.dependencies.load();
      if (generation !== entry.generation) return;
      await port.open({ baudRate: entry.state.kind === "rcp" ? 460800 : 115200 });
      if (generation !== entry.generation) return;
      const cacheDir = `/zwave-cache/${entry.state.kind}/${entry.state.id}`;
      const instance = entry.state.kind === "main" ? runtime.createMain(port, cacheDir, this.security)
        : entry.state.kind === "zniffer" ? runtime.createZniffer(port, this.security)
        : runtime.createRcp(port, cacheDir);
      entry.instance = instance;
      (instance as Driver).on("error", (error: Error) => {
        if (generation === entry.generation) {
          this.publish(entry, { error: error.message, status: "error" });
          if (entry.state.kind === "zniffer") {
            for (const listener of this.znifferErrorListeners) listener(error);
          }
        }
      });
      this.publish(entry, { status: "interviewing" });
      if (entry.state.kind === "main") {
        const driver = instance as Driver;
        const onDriverReady = async () => {
          if (generation !== entry.generation) return;
          if (driver.controller.ownNodeId !== 1) {
            this.publish(entry, { status: "error", error: `The main controller must be node 1. This controller is node ${driver.controller.ownNodeId}.` });
            return;
          }
          const radio = await verifyMainRadio(driver.controller);
          if (generation !== entry.generation) return;
          this.publish(entry, radio);
          entry.interviews = new Map();
          const refresh = () => {
            if (generation !== entry.generation) return;
            this.publish(entry, {
              status: entry.state.status === "error" ? "error" : "ready", controllerNodeId: driver.controller.ownNodeId,
              homeId: driver.controller.homeId,
            });
            this.refreshMainNodes(entry, driver);
          };
          for (const node of driver.controller.nodes.values()) {
            entry.interviews.set(node.id, { active: !node.ready });
            const updateInterview = (active: boolean, error?: string) => {
              if (generation !== entry.generation) return;
              entry.interviews?.set(node.id, { active, error });
              refresh();
            };
            node.on("ready", () => updateInterview(false));
            node.on("interview started", () => updateInterview(true));
            node.on("interview completed", () => updateInterview(false));
            node.on("interview failed", (_node, args) => updateInterview(!args.isFinal, args.errorMessage));
          }
          refresh();
        };
        driver.once("driver ready", () => {
          void onDriverReady().catch(error => {
            if (generation === entry.generation) {
              this.publish(entry, { status: "error", error: error instanceof Error ? error.message : String(error) });
            }
          });
        });
        driver.once("bootloader ready", () => {
          if (generation === entry.generation) this.publish(entry, { status: "error", error: "Controller is in bootloader mode" });
        });
        driver.once("cli ready", () => {
          if (generation === entry.generation) this.publish(entry, { status: "error", error: "Selected device exposes a CLI. Select a Serial API controller." });
        });
        await driver.start();
      } else if (entry.state.kind === "zniffer") {
        const zniffer = instance as Zniffer;
        zniffer.on("frame", (frame, rawData) => {
          if (generation !== entry.generation || !this.forwardCaptures) return;
          for (const listener of this.frameListeners) listener(frame, rawData);
        });
        zniffer.on("corrupted frame", (frame, rawData) => {
          if (generation !== entry.generation || !this.forwardCaptures) return;
          for (const listener of this.corruptedFrameListeners) listener(frame, rawData);
        });
        await zniffer.init();
        if (generation !== entry.generation) return;
        const radio = await configureZnifferRadio(zniffer);
        if (generation !== entry.generation) return;
        this.publish(entry, radio);
        await zniffer.start();
        if (generation === entry.generation) this.publish(entry, { status: entry.state.status === "error" ? "error" : "ready", capturing: true });
      } else {
        const rcp = instance as RCPHost;
        await rcp.start();
        if (generation !== entry.generation) return;
        const radio = await configureRcpRadio(rcp);
        if (generation !== entry.generation) return;
        this.publish(entry, radio);
        if (generation === entry.generation) this.publish(entry, { status: entry.state.status === "error" ? "error" : "ready" });
      }
    } catch (error) {
      if (generation === entry.generation) {
        let message = error instanceof Error ? error.message : String(error);
        try { await this.release(entry); }
        catch (cleanupError) { message += `; cleanup failed: ${String(cleanupError)}`; }
        this.publish(entry, { status: "error", error: message, capturing: false });
      }
      throw error;
    }
  }

  private watchDisconnects(serial: Serial) {
    if (this.serialWithListener) return;
    this.serialWithListener = serial;
    serial.addEventListener("disconnect", event => {
      const entry = this.owners.get(event.target as SerialPort);
      if (!entry) return;
      void this.disconnectEntry(entry).finally(() => {
        this.publish(entry, { status: "error", error: "Serial device disconnected. Reconnect it and choose Reconnect." });
      }).catch(() => {});
    });
  }

  private async release(entry: Entry) {
    const instance = entry.instance;
    entry.instance = undefined;
    try {
      if (entry.state.kind === "zniffer" && (instance as Zniffer | undefined)?.active) {
        await (instance as Zniffer).stop().catch(() => {});
      }
      await instance?.destroy();
    } finally {
      if (entry.port && this.owners.get(entry.port) === entry) {
        try { if (entry.port.readable || entry.port.writable) await entry.port.close(); }
        finally { this.owners.delete(entry.port); }
      }
    }
  }

  disconnect(kind: HardwareKind, id?: string): Promise<void> {
    if (kind === "main" && this.mainBusy) return Promise.reject(new Error("Wait for the main-controller operation and route cleanup to finish"));
    const entry = this.entry(kind, id);
    return this.disconnectEntry(entry);
  }

  private disconnectEntry(entry: Entry): Promise<void> {
    if (entry.teardown) return entry.teardown;
    ++entry.generation;
    this.publish(entry, { status: "disconnecting" });
    entry.teardown = (async () => {
      await entry.operation?.catch(() => {});
      try {
        await this.release(entry);
        this.publish(entry, { status: "disconnected", error: undefined, nodes: [], capturing: false });
      } catch (error) {
        this.publish(entry, { status: "error", error: error instanceof Error ? error.message : String(error), capturing: false });
        throw error;
      }
    })().finally(() => { entry.teardown = undefined; });
    return entry.teardown;
  }

  clearError(kind: HardwareKind, id?: string) {
    this.publish(this.entry(kind, id), { error: undefined });
  }

  removeRcp(id: string) {
    const key = `rcp:${id}`;
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.state.status !== "disconnected" || entry.instance || entry.operation || entry.teardown) {
      throw new Error("Disconnect the RCP before removing it");
    }
    this.entries.delete(key);
    this.refreshSnapshot();
  }

  getMainDriver(): Driver | undefined {
    const entry = this.entries.get("main:main");
    return entry?.state.status === "ready" && !entry.state.error ? entry.instance as Driver : undefined;
  }
  getZniffer(): Zniffer | undefined { return this.entries.get("zniffer:zniffer")?.instance as Zniffer | undefined; }
  getRcpHost(id: string): RCPHost | undefined {
    const entry = this.entries.get(`rcp:${id}`);
    return entry?.state.status === "ready" ? entry.instance as RCPHost : undefined;
  }
  async setCapture(active: boolean) {
    const entry = this.entries.get("zniffer:zniffer");
    if (!entry || entry.state.status !== "ready") throw new Error("Connect the Zniffer first");
    const generation = entry.generation;
    const zniffer = entry.instance as Zniffer;
    if (active === zniffer.active) return;
    if (active) await zniffer.start();
    else await zniffer.stop();
    if (generation === entry.generation) this.publish(entry, { capturing: active });
  }
}

export const hardware = new HardwareRuntime();
