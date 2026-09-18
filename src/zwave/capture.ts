import {
  AckLongRangeMPDU,
  AckZWaveMPDU,
  MPDU,
  Protocols,
  RoutedZWaveMPDU,
  SinglecastLongRangeMPDU,
  SinglecastZWaveMPDU,
  ZnifferProtocolDataRate,
  isRssiError,
  znifferProtocolDataRateToProtocolDataRate,
  znifferRegionToRFRegion,
} from "@zwave-js/core";
import { Bytes } from "@zwave-js/shared";
import type { CorruptedFrame, Frame } from "zwave-js/Zniffer";
import { LongRangeFrameType, ZWaveFrameType } from "zwave-js/safe";
import type { DemoFrame, FrameKind, FrameSpeed } from "../demo/types";

/** Carries the Zniffer callback arguments. rawData is the checksum-stripped MPDU. */
export type CaptureEvent =
  | { type: "frame"; frame: Frame; rawData: Uint8Array }
  | { type: "corrupted"; frame: CorruptedFrame; rawData: Uint8Array };

export const CAPTURE_DROP_REASONS = [
  "other-network",
  "unrelated-nodes",
  "unsupported-frame",
  "unknown-speed",
  "malformed-frame",
  "corrupted-frame",
  "invalid-timestamp",
] as const;
export type CaptureDropReason = typeof CAPTURE_DROP_REASONS[number];

export interface CaptureFilter {
  homeId: number;
  networkId: string;
  nodeIds?: readonly number[];
}

export interface CaptureMappingContext extends CaptureFilter {
  exchangeId: number;
  sequence: number;
  startedAt: number;
  receivedAt: number;
}

export type CaptureMappingResult =
  | { status: "mapped"; frame: DemoFrame }
  | { status: "dropped"; reason: CaptureDropReason };

const dropped = (reason: CaptureDropReason): CaptureMappingResult => ({ status: "dropped", reason });

function captureSpeed(rate: ZnifferProtocolDataRate): FrameSpeed | undefined {
  switch (rate) {
    case ZnifferProtocolDataRate.ZWave_9k6: return "9.6k";
    case ZnifferProtocolDataRate.ZWave_40k: return "40k";
    case ZnifferProtocolDataRate.ZWave_100k: return "100k";
    case ZnifferProtocolDataRate.LongRange_100k: return "LR";
  }
}

/** Maps one Zniffer event. Both times must use the same monotonic clock. */
export function mapCaptureFrame(event: CaptureEvent, context: CaptureMappingContext): CaptureMappingResult {
  if (event.type === "corrupted") return dropped("corrupted-frame");
  const { frame, rawData } = event;
  if (!frame || typeof frame !== "object") return dropped("malformed-frame");
  if (!("homeId" in frame)) return dropped("unsupported-frame");
  if (!Number.isInteger(frame.homeId)) return dropped("malformed-frame");
  if (frame.homeId !== context.homeId) return dropped("other-network");
  if (frame.protocol === Protocols.ZWave
    ? frame.type !== ZWaveFrameType.Singlecast && frame.type !== ZWaveFrameType.AckDirect
    : frame.type !== LongRangeFrameType.Singlecast && frame.type !== LongRangeFrameType.Ack) {
    return dropped("unsupported-frame");
  }
  const speed = captureSpeed(frame.protocolDataRate);
  if (!speed) return dropped("unknown-speed");
  if (frame.protocol !== (speed === "LR" ? Protocols.ZWaveLongRange : Protocols.ZWave)) {
    return dropped("malformed-frame");
  }
  if (!Number.isFinite(context.startedAt) || !Number.isFinite(context.receivedAt)
    || context.receivedAt < context.startedAt) {
    return dropped("invalid-timestamp");
  }
  if (!(rawData instanceof Uint8Array) || rawData.length < (speed === "LR" ? 12 : 9)) {
    return dropped("malformed-frame");
  }
  // Zniffer removes the checksum before emitting rawData. The length byte still includes it
  const checksumLength = speed === "9.6k" || speed === "40k" ? 1 : 2;
  if (rawData[7] !== rawData.length + checksumLength) return dropped("malformed-frame");

  let mpdu;
  try {
    mpdu = MPDU.parse(Bytes.view(rawData), {
      channel: frame.channel,
      region: znifferRegionToRFRegion(frame.region),
      protocolDataRate: znifferProtocolDataRateToProtocolDataRate(frame.protocolDataRate),
    });
  } catch {
    return dropped("malformed-frame");
  }
  if (!(mpdu instanceof SinglecastZWaveMPDU || mpdu instanceof RoutedZWaveMPDU
    || mpdu instanceof AckZWaveMPDU || mpdu instanceof SinglecastLongRangeMPDU
    || mpdu instanceof AckLongRangeMPDU)) {
    return dropped("unsupported-frame");
  }
  if (mpdu.homeId !== frame.homeId || mpdu.sourceNodeId !== frame.sourceNodeId
    || !("destinationNodeId" in frame) || mpdu.destinationNodeId !== frame.destinationNodeId
    || mpdu.sequenceNumber !== frame.sequenceNumber) {
    return dropped("malformed-frame");
  }
  const expectedType = mpdu instanceof AckZWaveMPDU ? ZWaveFrameType.AckDirect
    : mpdu instanceof AckLongRangeMPDU ? LongRangeFrameType.Ack
      : mpdu instanceof SinglecastLongRangeMPDU ? LongRangeFrameType.Singlecast : ZWaveFrameType.Singlecast;
  if (frame.type !== expectedType) return dropped("malformed-frame");
  const nodeLimit = speed === "LR" ? 4094 : 232;
  const validNode = (node: number) => Number.isInteger(node) && node > 0 && node <= nodeLimit;
  if (mpdu.destinationNodeId === (speed === "LR" ? 4095 : 255)) return dropped("unsupported-frame");
  if (!validNode(mpdu.sourceNodeId) || !validNode(mpdu.destinationNodeId)) return dropped("malformed-frame");

  let source = mpdu.sourceNodeId;
  let target = mpdu.destinationNodeId;
  let route = [source, target];
  let kind: FrameKind = mpdu instanceof AckZWaveMPDU || mpdu instanceof AckLongRangeMPDU ? "ACK" : "DATA";
  if (mpdu instanceof RoutedZWaveMPDU) {
    if (mpdu.repeaters.length < 1 || mpdu.repeaters.length > 4 || !mpdu.repeaters.every(validNode)
      || !Number.isInteger(mpdu.hop) || mpdu.hop < 0 || mpdu.hop > mpdu.repeaters.length
      || (mpdu.routedAck && mpdu.routedError)) {
      return dropped("malformed-frame");
    }
    if (!("direction" in frame) || frame.direction !== mpdu.direction || frame.hop !== mpdu.hop
      || frame.routedAck !== mpdu.routedAck || frame.routedError !== mpdu.routedError
      || !Array.isArray(frame.repeaters) || frame.repeaters.length !== mpdu.repeaters.length
      || !frame.repeaters.every((node, index) => node === mpdu.repeaters[index])) {
      return dropped("malformed-frame");
    }
    // Z-Wave JS normalizes inbound hop indexes to the outbound route
    route = mpdu.direction === "outbound"
      ? [source, ...mpdu.repeaters, target]
      : [target, ...mpdu.repeaters, source];
    if (new Set(route).size !== route.length) return dropped("malformed-frame");
    [source, target] = mpdu.direction === "outbound"
      ? [route[mpdu.hop], route[mpdu.hop + 1]]
      : [route[mpdu.hop + 1], route[mpdu.hop]];
    kind = mpdu.routedAck ? "ROUTED ACK" : mpdu.routedError ? "ROUTED ERROR" : "ROUTED DATA";
  }
  const nodeIds = context.nodeIds ?? [1, 2, 3];
  if (!route.every(node => nodeIds.includes(node))) return dropped("unrelated-nodes");

  return {
    status: "mapped",
    frame: {
      id: `${context.networkId}:${context.exchangeId}:${context.sequence}`,
      networkId: context.networkId,
      exchangeId: context.exchangeId,
      sequence: context.sequence,
      timestampMs: context.receivedAt - context.startedAt,
      source,
      target,
      route,
      kind,
      // A decoded CommandClass may expose decrypted bytes. MPDU keeps the received payload
      payload: Uint8Array.from(mpdu.payload),
      speed,
      rssi: typeof frame.rssi === "number" && Number.isFinite(frame.rssi) && !isRssiError(frame.rssi)
        ? frame.rssi : undefined,
      channel: Number.isInteger(frame.channel) && frame.channel >= 0 ? frame.channel : undefined,
    },
  };
}

export interface CaptureStats {
  captured: number;
  dropped: number;
  evicted: number;
  reasons: Record<CaptureDropReason, number>;
}

export interface CaptureSnapshot {
  frames: DemoFrame[];
  stats: CaptureStats;
}

function emptyStats(): CaptureStats {
  return {
    captured: 0,
    dropped: 0,
    evicted: 0,
    reasons: Object.fromEntries(CAPTURE_DROP_REASONS.map(reason => [reason, 0])) as Record<CaptureDropReason, number>,
  };
}

export const MAX_CAPTURE_FRAMES = 512;

/** Keeps capturing until start or reset. Action completion must leave capture armed for delayed ACKs. */
export function createCaptureHistory(options: CaptureFilter & { maxFrames?: number }) {
  const maxFrames = options.maxFrames ?? MAX_CAPTURE_FRAMES;
  if (!Number.isInteger(maxFrames) || maxFrames < 1) throw new RangeError("maxFrames must be a positive integer");
  const filter = { ...options, nodeIds: [...(options.nodeIds ?? [1, 2, 3])] };
  let frames: DemoFrame[] = [];
  let stats = emptyStats();
  let active: { exchangeId: number; startedAt: number; firstFrameAt?: number } | undefined;
  let sequence = 0;
  const snapshot = (): CaptureSnapshot => ({
    frames: [...frames],
    stats: { ...stats, reasons: { ...stats.reasons } },
  });
  const reset = () => {
    active = undefined;
    frames = [];
    stats = emptyStats();
    sequence = 0;
    return snapshot();
  };
  return {
    snapshot,
    reset,
    start(exchangeId: number, now = performance.now()) {
      if (!Number.isFinite(now)) throw new RangeError("Capture start time must be finite");
      reset();
      active = { exchangeId, startedAt: now };
      return snapshot();
    },
    ingest(event: CaptureEvent, now = performance.now()) {
      if (!active) return snapshot();
      const result = mapCaptureFrame(event, {
        ...filter,
        ...active,
        startedAt: active.firstFrameAt ?? active.startedAt,
        sequence: sequence + 1,
        receivedAt: now,
      });
      if (result.status === "dropped") {
        stats.dropped++;
        stats.reasons[result.reason]++;
      } else {
        if (active.firstFrameAt === undefined) {
          active.firstFrameAt = now;
          result.frame.timestampMs = 0;
        }
        sequence++;
        stats.captured++;
        frames.push(result.frame);
        if (frames.length > maxFrames) {
          frames.shift();
          stats.evicted++;
        }
      }
      return snapshot();
    },
  };
}
