import { ProtocolDataRate, SinglecastZWaveMPDU } from "@zwave-js/core";
import { TransmitCallbackStatus } from "@zwave-js/serial/rcp";
import { Bytes } from "@zwave-js/shared";
import { hardware, primaryRcpId } from "./hardware";
import { MAIN_CONTROLLER_NODE_ID, PLUG_NODE_ID, REPEATER_NODE_ID } from "./network";

export type RcpCommand = "plug-on" | "plug-off" | "plug-ping" | "multilevel-report";

export interface RcpCommandSpec {
  sourceNodeId: number;
  destinationNodeId: number;
  payload: Bytes;
  label: string;
}

export function rcpCommandSpec(command: RcpCommand, level = 50): RcpCommandSpec {
  if (command === "multilevel-report") {
    if (!Number.isInteger(level) || level < 0 || level > 99) {
      throw new RangeError("The Multilevel Switch report level must be between 0 and 99");
    }
    return {
      sourceNodeId: REPEATER_NODE_ID,
      destinationNodeId: MAIN_CONTROLLER_NODE_ID,
      payload: Bytes.from([0x26, 0x03, level]),
      label: `Multilevel Switch report: ${level}%`,
    };
  }
  return {
    sourceNodeId: MAIN_CONTROLLER_NODE_ID,
    destinationNodeId: PLUG_NODE_ID,
    payload: Bytes.from(command === "plug-ping"
      ? [0x00]
      : [0x25, 0x01, command === "plug-on" ? 0xff : 0x00]),
    label: command === "plug-ping" ? "Ping sent to plug"
      : `Switch Binary ${command === "plug-on" ? "On" : "Off"} sent to plug`,
  };
}

export function selectRcpCommandChannel(
  channels: readonly { channel: number; dataRate: ProtocolDataRate }[],
) {
  const selected = channels.find(channel => channel.dataRate === ProtocolDataRate.ZWave_100k)
    ?? channels.find(channel => channel.dataRate === ProtocolDataRate.ZWave_40k);
  if (!selected) throw new Error("The RCP region has no Classic 100 or 40 kbit/s channel");
  return selected;
}

export function encodeRcpCommand(
  spec: RcpCommandSpec,
  homeId: number,
  sequenceNumber: number,
  radio: { channel: number; dataRate: ProtocolDataRate; region: number },
) {
  return new SinglecastZWaveMPDU({
    homeId,
    sourceNodeId: spec.sourceNodeId,
    destinationNodeId: spec.destinationNodeId,
    ackRequested: true,
    sequenceNumber,
    payload: spec.payload,
  }).serialize({
    channel: radio.channel,
    protocolDataRate: radio.dataRate,
    region: radio.region,
  });
}

class RcpCommandController {
  private sequenceNumber = 0;

  async send(command: RcpCommand, level?: number) {
    return this.sendSpec(rcpCommandSpec(command, level));
  }

  async sendSpec(spec: RcpCommandSpec, rcpId = primaryRcpId) {
    const rcp = hardware.getRcpHost(rcpId);
    if (!rcp) throw new Error(`Connect RCP ${rcpId} first`);
    const main = hardware.getSnapshot().connections.find(connection => connection.kind === "main");
    if (main?.homeId === undefined) throw new Error("The main controller's Home ID is unavailable");
    const region = await rcp.queryRegion();
    const channel = selectRcpCommandChannel(region.channels);
    const frame = encodeRcpCommand(spec, main.homeId, this.sequenceNumber, {
      channel: channel.channel,
      dataRate: channel.dataRate,
      region: region.region,
    });
    this.sequenceNumber = (this.sequenceNumber + 1) & 0x0f;
    const status = await rcp.transmit(frame, {
      channel: channel.channel,
      txPower: 0,
      withCCA: true,
    });
    if (status !== TransmitCallbackStatus.Completed) {
      throw new Error(`RCP transmission failed with status ${status}`);
    }
    return spec.label;
  }
}

export const rcpCommands = new RcpCommandController();
