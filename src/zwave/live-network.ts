import { useSyncExternalStore } from "react";
import { CommandClasses } from "@zwave-js/core";
import type { Outcome } from "../demo/types";
import { createCaptureHistory, type CaptureSnapshot } from "./capture";
import { hardware, type Driver } from "./hardware";
import { PLUG_NODE_ID, mainNetworkNodes } from "./network";
import { PriorityRouteDemo, errorMessage, type DemoSpeed, type PlugAction, type RouteTransport } from "./priority-route";
import { createPlugTransport } from "./plug-transport";
import { getSetupStatus } from "./setup-status";

interface LiveNetworkState {
  busy: boolean;
  cleanupRequired: boolean;
  on: boolean | undefined;
  outcome: Outcome;
  capture: CaptureSnapshot;
}

class LiveNetwork {
  private listeners = new Set<() => void>();
  private routeDemo = new PriorityRouteDemo();
  private homeId: number | undefined;
  private history = createCaptureHistory({ homeId: 0, networkId: "main" });
  private driver: Driver | undefined;
  private unwatchNode: (() => void) | undefined;
  private exchange = 0;
  private state: LiveNetworkState = {
    busy: false, cleanupRequired: false, on: undefined,
    outcome: { kind: "idle", label: "" },
    capture: this.history.snapshot(),
  };

  constructor() {
    hardware.subscribe(() => this.refreshHardware());
    hardware.subscribeFrames((frame, rawData) => {
      if (this.homeId === undefined) return;
      this.update({ capture: this.history.ingest({ type: "frame", frame, rawData }) });
    });
    hardware.subscribeCorruptedFrames((frame, rawData) => {
      if (this.homeId === undefined) return;
      this.update({ capture: this.history.ingest({ type: "corrupted", frame, rawData }) });
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.state;

  clearCapture = () => {
    hardware.getZniffer()?.clearCapturedFrames();
    this.update({ capture: this.homeId === undefined ? this.history.reset() : this.history.start(++this.exchange) });
  };

  private update(change: Partial<LiveNetworkState>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }

  private refreshHardware() {
    const driver = hardware.getMainDriver();
    const homeId = driver?.controller.homeId;
    if (homeId !== undefined && homeId !== this.homeId) {
      this.homeId = homeId;
      this.history = createCaptureHistory({ homeId: this.homeId, networkId: String(this.homeId) });
      this.update({ capture: this.history.start(++this.exchange) });
    }
    if (this.driver !== driver) {
      this.unwatchNode?.();
      this.unwatchNode = undefined;
      this.driver = driver;
      const node = driver?.controller.nodes.get(PLUG_NODE_ID);
      if (node) {
        const update = () => this.update({ on: node.getValue<boolean>({
          commandClass: CommandClasses["Binary Switch"], property: "currentValue",
        }) });
        node.on("value updated", update);
        node.on("value added", update);
        this.unwatchNode = () => { node.off("value updated", update); node.off("value added", update); };
        update();
      } else this.update({ on: undefined });
    }
  }

  private transport(driver: Driver): RouteTransport {
    return createPlugTransport(driver.controller, driver.controller.nodes.getOrThrow(PLUG_NODE_ID), on => this.update({ on }));
  }

  action = async (action: PlugAction, routed: boolean, speed: DemoSpeed) => {
    if (this.state.busy) return;
    const readiness = liveReadiness();
    const driver = hardware.getMainDriver();
    if (!driver || !readiness.ready) {
      this.update({ outcome: { kind: "error", label: "Not connected", detail: readiness.reason } });
      return;
    }
    if (this.routeDemo.cleanupRequired) {
      this.update({ outcome: { kind: "error", label: "Priority route needs cleanup" } });
      return;
    }
    this.update({
      busy: true, outcome: { kind: "pending", label: "Sending", detail: routed ? "Via node 003" : "Direct" },
      capture: this.history.reset(),
    });
    let operation: ReturnType<typeof hardware.acquireMainOperation> | undefined;
    try {
      operation = hardware.acquireMainOperation();
      const detail = await this.routeDemo.run(this.transport(operation.driver), action, routed, speed, this.clearCapture);
      this.update({ outcome: { kind: "success", label: detail } });
    } catch (error) {
      this.update({ outcome: { kind: "error", label: "Demonstration failed", detail: errorMessage(error) } });
    } finally {
      this.update({ busy: false, cleanupRequired: this.routeDemo.cleanupRequired });
      operation?.release();
    }
  };

  clearRoute = async () => {
    const driver = hardware.getMainDriver();
    if (this.state.busy) return;
    if (!driver) {
      this.update({ outcome: { kind: "error", label: "Cleanup failed", detail: "Reconnect the main controller to clear the priority route." } });
      return;
    }
    this.update({ busy: true, outcome: { kind: "pending", label: "Clearing priority route" } });
    let operation: ReturnType<typeof hardware.acquireMainOperation> | undefined;
    try {
      operation = hardware.acquireMainOperation();
      const controller = operation.driver.controller;
      await this.routeDemo.clear({ setRoute: () => controller.removePriorityRoute(PLUG_NODE_ID) });
      this.update({ outcome: { kind: "success", label: "Priority route cleared" } });
    } catch (error) {
      this.update({ outcome: { kind: "error", label: "Cleanup failed", detail: errorMessage(error) } });
    } finally {
      this.update({ busy: false, cleanupRequired: this.routeDemo.cleanupRequired });
      operation?.release();
    }
  };
}

export function liveReadiness() {
  const snapshot = hardware.getSnapshot();
  const { connections } = snapshot;
  const main = connections.find(connection => connection.kind === "main");
  const zniffer = connections.find(connection => connection.kind === "zniffer");
  let reason = main?.error || zniffer?.error || getSetupStatus(snapshot).reason;
  if (!reason && main) {
    if (main.controllerNodeId !== 1) reason = "The main controller must be node 001.";
    else if (main.homeId === undefined) reason = "The controller's network Home ID is not available.";
    else if (![2, 3].every(id => main.nodes.some(node => node.id === id && node.ready))) reason = "Wait for nodes 002 and 003 to finish their interviews.";
    else if (!hardware.getMainDriver()?.controller.nodes.get(2)?.supportsCC(CommandClasses["Binary Switch"])) reason = "Node 002 must support Switch Binary.";
  }
  return { ready: !reason, reason, networkId: main?.homeId === undefined ? "main" : String(main.homeId) };
}

export const liveNetwork = new LiveNetwork();

export function useLiveNetwork() {
  const state = useSyncExternalStore(liveNetwork.subscribe, liveNetwork.getSnapshot, liveNetwork.getSnapshot);
  const hardwareState = useSyncExternalStore(hardware.subscribe, hardware.getSnapshot, hardware.getSnapshot);
  const readiness = liveReadiness();
  const { stats } = state.capture;
  const filtered = stats.reasons["other-network"] + stats.reasons["unrelated-nodes"];
  const discarded = stats.dropped - filtered;
  const captureStatus = readiness.ready
    ? `Captured: ${stats.captured} · Filtered: ${filtered} · Invalid/unsupported: ${discarded} · Evicted: ${stats.evicted}`
    : readiness.reason;
  return { ...state, ...readiness, busy: state.busy || hardwareState.mainBusy, hardware: hardwareState, captureStatus, nodes: mainNetworkNodes(readiness.networkId) };
}
