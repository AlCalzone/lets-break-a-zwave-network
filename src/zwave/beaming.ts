import {
  ProtocolDataRate,
  encodeLongRangeBeamFrame,
  encodeZWaveBeamFrame,
  longRangeHomeIdHash,
} from "@zwave-js/core";
import { TransmitCallbackStatus } from "@zwave-js/serial/rcp";
import { useSyncExternalStore } from "react";
import { hardware, primaryRcpId } from "./hardware";

export const beamingTargetNodeId = 4;
export const fragmentedBeamingTargetNodeId = 257;

export type BeamKind = "continuous" | "short" | "long" | "fragmented";

interface BeamingSnapshot {
  active: boolean;
  kind?: BeamKind;
  notice: string;
  error?: string;
}

const initialSnapshot: BeamingSnapshot = {
  active: false,
  notice: `Ready to beam toward nonexistent node ${String(beamingTargetNodeId).padStart(3, "0")}.`,
};

export function beamParameters(
  kind: BeamKind,
  channels: readonly { channel: number; dataRate: ProtocolDataRate; frequency?: number }[],
) {
  const classicChannels = channels.filter(channel => channel.channel < 3);
  if (kind === "fragmented") {
    const longRangeChannels = channels.filter(channel => channel.dataRate === ProtocolDataRate.LongRange_100k);
    if (!longRangeChannels.length) {
      const reportedChannels = channels
        .map(channel => `${channel.channel}: ${
          channel.frequency === undefined ? "unknown frequency" : `${channel.frequency / 1_000_000} MHz`
        }, rate ${channel.dataRate}`)
        .join("; ");
      throw new Error(`The RCP region has no Long Range channel. Reported channels: ${reportedChannels || "none"}`);
    }
    return {
      numFragments: 16,
      fragmentDurationMs: 112,
      fragmentPeriodMs: 200,
      channels: longRangeChannels.map(channel => channel.channel),
    };
  }
  const continuousChannel = classicChannels.find(channel => channel.dataRate === ProtocolDataRate.ZWave_40k);
  if (!continuousChannel) throw new Error("The RCP region has no Classic 40 kbit/s channel");
  const duration = kind === "short" ? 275 : kind === "long" ? 1100 : 65_535;
  return {
    numFragments: 1,
    fragmentDurationMs: duration,
    fragmentPeriodMs: duration,
    channels: [continuousChannel.channel],
  };
}

class BeamingController {
  private listeners = new Set<() => void>();
  private snapshot = initialSnapshot;
  private operation?: Promise<void>;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.snapshot;

  private update(patch: Partial<BeamingSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  async start(kind: BeamKind) {
    if (this.operation) throw new Error("A beam transmission is already running");
    const rcp = hardware.getRcpHost(primaryRcpId);
    if (!rcp) throw new Error("Connect the Beaming RCP first");
    const region = await rcp.queryRegion();
    const parameters = beamParameters(kind, region.channels);
    const main = hardware.getSnapshot().connections.find(connection => connection.kind === "main");
    const txPower = 0;
    const data = kind === "fragmented"
      ? encodeLongRangeBeamFrame({
        destinationNodeId: fragmentedBeamingTargetNodeId,
        txPower,
        homeIdHash: longRangeHomeIdHash(main?.homeId
          ?? (() => { throw new Error("The main controller's Home ID is unavailable"); })()),
      })
      : encodeZWaveBeamFrame({ destinationNodeId: beamingTargetNodeId });

    this.update({
      active: true,
      kind,
      error: undefined,
      notice: kind === "continuous" ? "Continuous beam active."
        : `${kind[0].toUpperCase()}${kind.slice(1)} beam active.`,
    });
    const operation = (async () => {
      const status = await rcp.transmitBeam({
        ...parameters,
        txPower,
        data,
      });
      if (status !== TransmitCallbackStatus.Completed && status !== TransmitCallbackStatus.Aborted) {
        throw new Error(`RCP beam transmission failed with status ${status}`);
      }
      this.update({
        notice: status === TransmitCallbackStatus.Aborted ? "Beam stopped." : "Beam completed.",
        error: undefined,
      });
    })();
    this.operation = operation;
    try {
      await operation;
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : String(error), notice: "" });
      throw error;
    } finally {
      if (this.operation === operation) {
        this.operation = undefined;
        this.update({ active: false, kind: undefined });
      }
    }
  }

  async stop() {
    const rcp = hardware.getRcpHost(primaryRcpId);
    if (!rcp) throw new Error("Connect the Beaming RCP first");
    if (!this.operation) {
      this.update({ active: false, kind: undefined, notice: "No beam is active.", error: undefined });
      return;
    }
    await rcp.abortBeam();
  }
}

export const beaming = new BeamingController();

export function useBeaming() {
  return useSyncExternalStore(beaming.subscribe, beaming.getSnapshot, beaming.getSnapshot);
}
