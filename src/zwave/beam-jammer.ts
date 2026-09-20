import { ProtocolDataRate, encodeZWaveBeamFrame } from "@zwave-js/core";
import { TransmitCallbackStatus } from "@zwave-js/serial/rcp";
import { useSyncExternalStore } from "react";
import { hardware, jammerRcpIds } from "./hardware";

export const BEAM_JAMMER_TARGET_NODE_ID = 7;
export const BEAM_JAMMER_DURATION_MS = 1100;
export const BEAM_JAMMER_BUSY_RETRY_MS = 50;

interface BeamJammerSnapshot {
  active: boolean;
  beamsCompleted: number;
  activeRcpId?: string;
  error?: string;
}

export function selectBeamJammerChannel(
  channels: readonly { channel: number; dataRate: ProtocolDataRate }[],
) {
  const channel = channels.find(candidate => candidate.dataRate === ProtocolDataRate.ZWave_40k);
  if (!channel) throw new Error("An RCP region has no Classic 40 kbit/s channel");
  return channel;
}

export function beamJammerParameters(channel: number) {
  return {
    numFragments: 1,
    fragmentDurationMs: BEAM_JAMMER_DURATION_MS,
    fragmentPeriodMs: BEAM_JAMMER_DURATION_MS,
    channels: [channel],
    txPower: 0,
    data: encodeZWaveBeamFrame({ destinationNodeId: BEAM_JAMMER_TARGET_NODE_ID }),
  };
}

class BeamJammer {
  private listeners = new Set<() => void>();
  private snapshot: BeamJammerSnapshot = { active: false, beamsCompleted: 0 };
  private generation = 0;
  private operation?: Promise<void>;
  private activeRadio?: NonNullable<ReturnType<typeof hardware.getRcpHost>>;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.snapshot;

  private update(change: Partial<BeamJammerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }

  async start() {
    if (this.snapshot.active) return;
    const generation = ++this.generation;
    this.update({
      active: true,
      beamsCompleted: 0,
      activeRcpId: undefined,
      error: undefined,
    });
    try {
      const radios = await Promise.all(jammerRcpIds.map(async id => {
        const rcp = hardware.getRcpHost(id);
        if (!rcp) throw new Error(`Connect RCP ${id} first`);
        const region = await rcp.queryRegion();
        return { id, rcp, channel: selectBeamJammerChannel(region.channels) };
      }));
      if (generation !== this.generation) return;

      const operation = this.run(generation, radios).catch(error => {
        if (generation === this.generation) {
          ++this.generation;
          this.update({
            active: false,
            activeRcpId: undefined,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }).finally(() => {
        if (this.operation === operation) this.operation = undefined;
        if (generation === this.generation) {
          this.update({ active: false, activeRcpId: undefined });
        }
      });
      this.operation = operation;
    } catch (error) {
      if (generation === this.generation) {
        ++this.generation;
        this.update({
          active: false,
          activeRcpId: undefined,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async run(
    generation: number,
    radios: readonly {
      id: string;
      rcp: NonNullable<ReturnType<typeof hardware.getRcpHost>>;
      channel: { channel: number; dataRate: ProtocolDataRate };
    }[],
  ) {
    let index = 0;
    while (generation === this.generation) {
      const radio = radios[index];
      this.activeRadio = radio.rcp;
      this.update({ activeRcpId: radio.id });
      let status: Awaited<ReturnType<typeof radio.rcp.transmitBeam>>;
      try {
        status = await radio.rcp.transmitBeam(beamJammerParameters(radio.channel.channel));
      } finally {
        if (this.activeRadio === radio.rcp) this.activeRadio = undefined;
      }
      if (generation !== this.generation) {
        if (status === TransmitCallbackStatus.Completed || status === TransmitCallbackStatus.Aborted) return;
        throw new Error(`RCP ${radio.id} failed with status ${status}`);
      }
      if (status === TransmitCallbackStatus.ChannelBusy) {
        await new Promise(resolve => setTimeout(resolve, BEAM_JAMMER_BUSY_RETRY_MS));
        continue;
      }
      if (status !== TransmitCallbackStatus.Completed) {
        throw new Error(`RCP ${radio.id} failed with status ${status}`);
      }
      this.update({
        beamsCompleted: this.snapshot.beamsCompleted + 1,
        activeRcpId: undefined,
      });
      index = (index + 1) % radios.length;
    }
  }

  async stop() {
    if (!this.snapshot.active && !this.operation) return;
    ++this.generation;
    this.update({ active: false, activeRcpId: undefined });
    const radio = this.activeRadio;
    this.activeRadio = undefined;
    if (radio) {
      try {
        await radio.abortBeam();
      } catch (error) {
        this.update({ error: error instanceof Error ? error.message : String(error) });
      }
    }
    await this.operation;
    this.operation = undefined;
  }
}

export const beamJammer = new BeamJammer();

export function useBeamJammer() {
  return useSyncExternalStore(beamJammer.subscribe, beamJammer.getSnapshot, beamJammer.getSnapshot);
}
