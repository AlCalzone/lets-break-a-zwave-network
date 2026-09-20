import { ProtocolDataRate, SinglecastZWaveMPDU } from "@zwave-js/core";
import { TransmitCallbackStatus } from "@zwave-js/serial/rcp";
import { Bytes } from "@zwave-js/shared";
import { useSyncExternalStore } from "react";
import { hardware, jammerRcpIds } from "./hardware";

export const JAMMER_TARGET_NODE_ID = 7;
export const JAMMER_FRAME_BYTES = 64;
export const JAMMER_STAGGER_MS = 30;
export const JAMMER_CYCLE_MS = 90;

interface JammerSnapshot {
  active: boolean;
  framesSent: number;
  error?: string;
}

export function selectJammerChannel(
  channels: readonly { channel: number; dataRate: ProtocolDataRate }[],
) {
  const channel = channels.find(candidate => candidate.dataRate === ProtocolDataRate.ZWave_9k6);
  if (!channel) throw new Error("An RCP region has no Classic 9.6 kbit/s channel");
  return channel;
}

export function encodeJammerFrame(options: {
  homeId: number;
  sourceNodeId: number;
  sequenceNumber: number;
  channel: number;
  region: number;
}) {
  const payload = Bytes.from([0x00, ...Array(53).fill(0xa5)]);
  return new SinglecastZWaveMPDU({
    homeId: options.homeId,
    sourceNodeId: options.sourceNodeId,
    destinationNodeId: JAMMER_TARGET_NODE_ID,
    ackRequested: true,
    sequenceNumber: options.sequenceNumber,
    payload,
  }).serialize({
    channel: options.channel,
    protocolDataRate: ProtocolDataRate.ZWave_9k6,
    region: options.region,
  });
}

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

class NetworkJammer {
  private listeners = new Set<() => void>();
  private snapshot: JammerSnapshot = { active: false, framesSent: 0 };
  private generation = 0;
  private operation?: Promise<void>;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.snapshot;

  private update(change: Partial<JammerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }

  async start() {
    if (this.snapshot.active) return;
    const generation = ++this.generation;
    this.update({ active: true, framesSent: 0, error: undefined });
    try {
      const main = hardware.getSnapshot().connections.find(connection => connection.kind === "main");
      if (main?.homeId === undefined) throw new Error("The main controller's Home ID is unavailable");
      const radios = await Promise.all(jammerRcpIds.map(async (id, index) => {
        const rcp = hardware.getRcpHost(id);
        if (!rcp) throw new Error(`Connect RCP ${id} first`);
        const region = await rcp.queryRegion();
        return { rcp, index, region, channel: selectJammerChannel(region.channels) };
      }));
      if (generation !== this.generation) return;

      this.operation = Promise.all(radios.map(radio =>
        this.runRadio(generation, main.homeId!, radio),
      )).then(() => undefined).catch(error => {
        if (generation === this.generation) {
          ++this.generation;
          this.update({ active: false, error: error instanceof Error ? error.message : String(error) });
        }
      }).finally(() => {
        if (generation === this.generation) this.update({ active: false });
      });
    } catch (error) {
      if (generation === this.generation) {
        ++this.generation;
        this.update({ active: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  private async runRadio(
    generation: number,
    homeId: number,
    radio: {
      rcp: NonNullable<ReturnType<typeof hardware.getRcpHost>>;
      index: number;
      region: Awaited<ReturnType<NonNullable<ReturnType<typeof hardware.getRcpHost>>["queryRegion"]>>;
      channel: { channel: number; dataRate: ProtocolDataRate };
    },
  ) {
    let sequenceNumber = radio.index;
    await delay(radio.index * JAMMER_STAGGER_MS);
    while (generation === this.generation) {
      const frame = encodeJammerFrame({
        homeId,
        sourceNodeId: 4 + radio.index,
        sequenceNumber,
        channel: radio.channel.channel,
        region: radio.region.region,
      });
      sequenceNumber = (sequenceNumber + jammerRcpIds.length) & 0x0f;
      const status = await radio.rcp.transmit(frame, {
        channel: radio.channel.channel,
        txPower: 0,
        withCCA: false,
      });
      if (status !== TransmitCallbackStatus.Completed) {
        throw new Error(`RCP ${jammerRcpIds[radio.index]} failed with status ${status}`);
      }
      if (generation === this.generation) this.update({ framesSent: this.snapshot.framesSent + 1 });
      await delay(JAMMER_CYCLE_MS - JAMMER_FRAME_BYTES * 8 / 9.6);
    }
  }

  async stop() {
    if (!this.snapshot.active && !this.operation) return;
    ++this.generation;
    this.update({ active: false });
    await this.operation;
    this.operation = undefined;
  }
}

export const networkJammer = new NetworkJammer();

export function useNetworkJammer() {
  return useSyncExternalStore(networkJammer.subscribe, networkJammer.getSnapshot, networkJammer.getSnapshot);
}
