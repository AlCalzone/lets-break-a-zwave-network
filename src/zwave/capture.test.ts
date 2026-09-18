import assert from "node:assert/strict";
import test from "node:test";
import { BasicCCSet } from "@zwave-js/cc";
import {
  AckLongRangeMPDU,
  AckZWaveMPDU,
  MPDUHeaderType,
  Protocols,
  RFRegion,
  RoutedZWaveMPDU,
  RssiError,
  SinglecastLongRangeMPDU,
  SinglecastZWaveMPDU,
  ZnifferProtocolDataRate,
  ZnifferRegion,
  znifferProtocolDataRateToProtocolDataRate,
  type RoutedZWaveMPDUOptions,
} from "@zwave-js/core";
import { Bytes } from "@zwave-js/shared";
import type { Frame, ZWaveFrame } from "zwave-js/Zniffer";
import { LongRangeFrameType, ZWaveFrameType } from "zwave-js/safe";
import type { DemoFrame } from "../demo/types";
import {
  CAPTURE_DROP_REASONS,
  createCaptureHistory,
  mapCaptureFrame,
  type CaptureEvent,
  type CaptureMappingContext,
} from "./capture";

const HOME_ID = 0xcafebabe;
const context: CaptureMappingContext = {
  homeId: HOME_ID,
  networkId: "main",
  exchangeId: 4,
  sequence: 1,
  startedAt: 100,
  receivedAt: 104.25,
};
const base = {
  homeId: HOME_ID,
  sourceNodeId: 1,
  destinationNodeId: 2,
  sequenceNumber: 7,
};

function eventFor(
  mpdu: SinglecastZWaveMPDU | AckZWaveMPDU | RoutedZWaveMPDU | SinglecastLongRangeMPDU | AckLongRangeMPDU,
  rate = ZnifferProtocolDataRate.ZWave_100k,
): Extract<CaptureEvent, { type: "frame" }> {
  const info = {
    channel: rate === ZnifferProtocolDataRate.LongRange_100k ? 3 : 0,
    region: ZnifferRegion.Europe,
    rssiRaw: 42,
    rssi: -64,
    protocolDataRate: rate,
    homeId: mpdu.homeId,
    sourceNodeId: mpdu.sourceNodeId,
    destinationNodeId: mpdu.destinationNodeId,
    sequenceNumber: mpdu.sequenceNumber,
  };
  let frame: Frame;
  if (mpdu instanceof SinglecastLongRangeMPDU || mpdu instanceof AckLongRangeMPDU) {
    const common = {
      ...info,
      protocol: Protocols.ZWaveLongRange as const,
      noiseFloor: mpdu.noiseFloor,
      txPower: mpdu.txPower,
      payload: Bytes.from(mpdu.payload),
    };
    frame = mpdu instanceof AckLongRangeMPDU
      ? { ...common, type: LongRangeFrameType.Ack, incomingRSSI: mpdu.incomingRSSI }
      : { ...common, type: LongRangeFrameType.Singlecast, ackRequested: mpdu.ackRequested };
  } else if (mpdu instanceof AckZWaveMPDU) {
    frame = { ...info, protocol: Protocols.ZWave, speedModified: false, type: ZWaveFrameType.AckDirect };
  } else {
    const common = {
      ...info,
      protocol: Protocols.ZWave as const,
      speedModified: false,
      type: ZWaveFrameType.Singlecast as const,
      ackRequested: mpdu.ackRequested,
      payload: Bytes.from(mpdu.payload),
    };
    frame = mpdu instanceof RoutedZWaveMPDU
      ? {
        ...common,
        direction: mpdu.direction,
        hop: mpdu.hop,
        repeaters: [...mpdu.repeaters],
        ...(mpdu.routedError
          ? { routedAck: false as const, routedError: true as const, failedHop: mpdu.failedHop! }
          : mpdu.routedAck
            ? { routedAck: true as const, routedError: false as const }
            : { routedAck: false as const, routedError: false as const }),
      }
      : common;
  }
  return {
    type: "frame",
    frame,
    rawData: mpdu.serialize({
      channel: info.channel,
      region: RFRegion.Europe,
      protocolDataRate: znifferProtocolDataRateToProtocolDataRate(rate),
    }),
  };
}

function direct(rate = ZnifferProtocolDataRate.ZWave_100k, payload = [0x20, 0x01, 0xff]) {
  return eventFor(new SinglecastZWaveMPDU({
    ...base, ackRequested: true, payload: Bytes.from(payload),
  }), rate);
}

function routed(options: Partial<RoutedZWaveMPDUOptions> = {}) {
  return eventFor(new RoutedZWaveMPDU({
    ...base,
    headerType: MPDUHeaderType.Singlecast,
    ackRequested: true,
    routed: true,
    direction: "outbound",
    routedAck: false,
    routedError: false,
    hop: 0,
    repeaters: [3],
    payload: Bytes.from([0x20, 0x01, 0xff]),
    ...options,
  }));
}

function mapped(event: CaptureEvent, overrides: Partial<CaptureMappingContext> = {}): DemoFrame {
  const result = mapCaptureFrame(event, { ...context, ...overrides });
  assert.equal(result.status, "mapped", JSON.stringify(result));
  return result.frame;
}

test("direct capture preserves the received payload, endpoints and measurements", () => {
  const event = direct();
  const result = mapped(event);
  assert.deepEqual(result, {
    id: "main:4:1",
    networkId: "main",
    exchangeId: 4,
    sequence: 1,
    timestampMs: 4.25,
    source: 1,
    target: 2,
    route: [1, 2],
    kind: "DATA",
    payload: Uint8Array.from([0x20, 0x01, 0xff]),
    speed: "100k",
    rssi: -64,
    channel: 0,
  });
  event.rawData.fill(0);
  assert.deepEqual([...result.payload], [0x20, 0x01, 0xff]);
  assert.equal(result.retry, undefined);
});

test("payload bytes come from the captured MPDU when the event contains a decoded command", () => {
  const event = direct(ZnifferProtocolDataRate.ZWave_100k, [0x9f, 0x03, 0x91, 0x12, 0x34]);
  assert.ok("payload" in event.frame);
  event.frame.payload = new BasicCCSet({ nodeId: 2, targetValue: 255 });
  assert.deepEqual([...mapped(event).payload], [0x9f, 0x03, 0x91, 0x12, 0x34]);
});

test("routed data maps each actual hop separately", () => {
  const first = mapped(routed());
  const repeated = mapped(routed({ hop: 1 }));
  assert.deepEqual([first.source, first.target], [1, 3]);
  assert.deepEqual([repeated.source, repeated.target], [3, 2]);
  assert.deepEqual(first.route, [1, 3, 2]);
  assert.deepEqual(repeated.route, first.route);
  assert.equal(first.kind, "ROUTED DATA");
  assert.deepEqual([...first.payload], [0x20, 0x01, 0xff]);
});

test("routed ACK uses normalized reverse hops and reversed MAC endpoints", () => {
  const ack = (hop: number) => routed({
    sourceNodeId: 2,
    destinationNodeId: 1,
    direction: "inbound",
    routedAck: true,
    ackRequested: false,
    hop,
    payload: Bytes.from([]),
  });
  const first = mapped(ack(1));
  const last = mapped(ack(0));
  assert.equal(first.kind, "ROUTED ACK");
  assert.deepEqual(first.route, [1, 3, 2]);
  assert.deepEqual(last.route, first.route);
  assert.deepEqual([first.source, first.target], [2, 3]);
  assert.deepEqual([last.source, last.target], [3, 1]);
  assert.equal(first.payload.length, 0);
  assert.equal(last.payload.length, 0);
});

test("direct ACK remains one observed ACK with an empty payload", () => {
  const ack = eventFor(new AckZWaveMPDU({ ...base, sourceNodeId: 2, destinationNodeId: 1 }));
  const result = mapped(ack);
  assert.equal(result.kind, "ACK");
  assert.deepEqual([result.source, result.target, result.payload.length], [2, 1, 0]);
});

test("inbound routed errors use their observed link", () => {
  const frame = mapped(routed({
    sourceNodeId: 2,
    destinationNodeId: 1,
    direction: "inbound",
    routedError: true,
    failedHop: 0,
    hop: 0,
    payload: Bytes.from([]),
  }));
  assert.equal(frame.kind, "ROUTED ERROR");
  assert.deepEqual([frame.source, frame.target], [3, 1]);
});

test("all four supported radio speeds come from the capture metadata", () => {
  for (const [rate, label] of [
    [ZnifferProtocolDataRate.ZWave_9k6, "9.6k"],
    [ZnifferProtocolDataRate.ZWave_40k, "40k"],
    [ZnifferProtocolDataRate.ZWave_100k, "100k"],
  ] as const) {
    assert.equal(mapped(direct(rate)).speed, label);
  }
  const lr = eventFor(new SinglecastLongRangeMPDU({
    ...base, sourceNodeId: 256, destinationNodeId: 1,
    ackRequested: true, noiseFloor: -105, txPower: 14,
    payload: Bytes.from([0x20, 0x01, 0xff]),
  }), ZnifferProtocolDataRate.LongRange_100k);
  const frame = mapped(lr, { nodeIds: [1, 256] });
  assert.equal(frame.speed, "LR");
  assert.equal(frame.channel, 3);
  assert.deepEqual(frame.route, [256, 1]);
  const ack = eventFor(new AckLongRangeMPDU({
    ...base, sourceNodeId: 1, destinationNodeId: 256,
    noiseFloor: -105, txPower: 14, incomingRSSI: -61, payload: Bytes.from([0xab]),
  }), ZnifferProtocolDataRate.LongRange_100k);
  const reply = mapped(ack, { nodeIds: [1, 256] });
  assert.equal(reply.kind, "ACK");
  assert.deepEqual([...reply.payload], [0xab]);
});

test("RSSI sentinels and missing measurements do not become invented readings", () => {
  for (const rssi of [undefined, Number.NaN, RssiError.NotAvailable, RssiError.NoSignalDetected, RssiError.ReceiverSaturated]) {
    const event = direct();
    event.frame = { ...event.frame, rssi } as Frame;
    assert.equal(mapped(event).rssi, undefined);
  }
  const event = direct();
  event.frame.channel = Number.NaN;
  assert.equal(mapped(event).channel, undefined);
});

test("main Home ID and complete route membership filter other traffic", () => {
  assert.deepEqual(mapCaptureFrame(direct(), { ...context, homeId: 1 }), {
    status: "dropped", reason: "other-network",
  });
  assert.deepEqual(mapCaptureFrame(routed({ repeaters: [4] }), context), {
    status: "dropped", reason: "unrelated-nodes",
  });
  assert.deepEqual(mapCaptureFrame(routed({ destinationNodeId: 4 }), context), {
    status: "dropped", reason: "unrelated-nodes",
  });
});

test("beams and explorer frames are counted as unsupported", () => {
  const beam: CaptureEvent = {
    type: "frame",
    frame: { protocol: Protocols.ZWave, type: ZWaveFrameType.BeamStop, channel: 0 },
    rawData: new Uint8Array(),
  };
  const explorer = direct();
  explorer.frame = {
    ...base,
    protocol: Protocols.ZWave, type: ZWaveFrameType.ExplorerNormal, channel: 0,
    region: ZnifferRegion.Europe, protocolDataRate: ZnifferProtocolDataRate.ZWave_100k,
    rssiRaw: 42, speedModified: false, ackRequested: true,
    direction: "outbound", repeaters: [], ttl: 3, payload: Bytes.from([0x20, 0x01, 0xff]),
  };
  for (const event of [beam, explorer]) {
    assert.deepEqual(mapCaptureFrame(event, context), { status: "dropped", reason: "unsupported-frame" });
  }
});

test("unknown rates, corrupted captures and bad timestamps have explicit drop reasons", () => {
  const unknown = direct();
  (unknown.frame as ZWaveFrame).protocolDataRate = 99 as ZnifferProtocolDataRate;
  assert.deepEqual(mapCaptureFrame(unknown, context), { status: "dropped", reason: "unknown-speed" });
  const corrupted: CaptureEvent = {
    type: "corrupted",
    frame: {
      channel: 0, region: ZnifferRegion.Europe, rssiRaw: 42,
      protocolDataRate: ZnifferProtocolDataRate.ZWave_100k, payload: Bytes.from([1, 2, 3]),
    },
    rawData: Uint8Array.from([1, 2, 3]),
  };
  assert.deepEqual(mapCaptureFrame(corrupted, context), { status: "dropped", reason: "corrupted-frame" });
  for (const receivedAt of [99, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(mapCaptureFrame(direct(), { ...context, receivedAt }), {
      status: "dropped", reason: "invalid-timestamp",
    });
  }
});

test("invalid MPDU lengths, hops, node IDs and mismatched event headers are dropped", () => {
  const truncated = direct();
  truncated.rawData = truncated.rawData.subarray(0, 7);
  const missingPayloadByte = direct();
  missingPayloadByte.rawData = missingPayloadByte.rawData.subarray(0, -1);
  const mismatchedHeader = direct();
  (mismatchedHeader.frame as ZWaveFrame).sourceNodeId = 3;
  const mismatchedRoute = routed();
  assert.ok("repeaters" in mismatchedRoute.frame);
  mismatchedRoute.frame.repeaters = [2];
  for (const event of [
    truncated, missingPayloadByte, mismatchedHeader, mismatchedRoute,
    routed({ hop: 2 }), routed({ repeaters: [0] }), routed({ repeaters: [1] }),
  ]) {
    assert.deepEqual(mapCaptureFrame(event, context), { status: "dropped", reason: "malformed-frame" });
  }
});

test("history has no synthetic frames and keeps receiving delayed ACKs until reset", () => {
  const history = createCaptureHistory({ homeId: HOME_ID, networkId: "main", maxFrames: 2 });
  assert.equal(history.ingest(direct(), 99).stats.captured, 0);
  assert.equal(history.start(41, 100).frames.length, 0);
  history.ingest(routed(), 101);
  history.ingest(routed({ hop: 1 }), 105);
  const snapshot = history.ingest(eventFor(new AckZWaveMPDU({
    ...base, sourceNodeId: 2, destinationNodeId: 1,
  })), 750);
  assert.deepEqual(snapshot.frames.map(frame => frame.sequence), [2, 3]);
  assert.deepEqual(snapshot.frames.map(frame => frame.timestampMs), [4, 649]);
  assert.deepEqual(snapshot.frames.map(frame => frame.exchangeId), [41, 41]);
  assert.equal(snapshot.frames[1].kind, "ACK");
  assert.equal(snapshot.stats.captured, 3);
  assert.equal(snapshot.stats.evicted, 1);
  assert.equal(snapshot.stats.dropped, 0);
  assert.equal(history.start(42, 800).frames.length, 0);
  const next = history.ingest(direct(), 802);
  assert.deepEqual(next.frames.map(frame => [frame.exchangeId, frame.sequence, frame.timestampMs]), [[42, 1, 0]]);
  history.reset();
  assert.equal(history.ingest(direct(), 900).frames.length, 0);
});

test("the first accepted frame starts at zero after setup delays and discarded traffic", () => {
  const history = createCaptureHistory({ homeId: HOME_ID, networkId: "main" });
  history.start(1, 100);
  history.ingest(routed({ repeaters: [4] }), 120);
  const first = history.ingest(direct(), 130.25);
  assert.equal(first.frames[0].timestampMs, 0);
  assert.equal(first.stats.dropped, 1);
  const next = history.ingest(direct(), 134.75);
  assert.equal(next.frames[1].timestampMs, 4.5);
  history.reset();
  assert.equal(history.ingest(direct(), 150).frames.length, 0);
});

test("history exposes drop counts without producing placeholder rows", () => {
  const history = createCaptureHistory({ homeId: HOME_ID, networkId: "main" });
  history.start(1, 100);
  history.ingest(routed({ repeaters: [4] }), 105);
  history.ingest({ type: "frame", frame: {
    protocol: Protocols.ZWave, type: ZWaveFrameType.BeamStop, channel: 0,
  }, rawData: new Uint8Array() }, 106);
  const snapshot = history.snapshot();
  assert.equal(snapshot.frames.length, 0);
  assert.equal(snapshot.stats.captured, 0);
  assert.equal(snapshot.stats.dropped, 2);
  assert.equal(snapshot.stats.reasons["unrelated-nodes"], 1);
  assert.equal(snapshot.stats.reasons["unsupported-frame"], 1);
  assert.deepEqual(Object.keys(snapshot.stats.reasons), [...CAPTURE_DROP_REASONS]);
  snapshot.stats.reasons["unsupported-frame"] = 99;
  snapshot.frames.push(mapped(direct()));
  assert.equal(history.snapshot().stats.reasons["unsupported-frame"], 1);
  assert.deepEqual(history.snapshot().frames, []);
  for (const maxFrames of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => createCaptureHistory({ homeId: HOME_ID, networkId: "main", maxFrames }), RangeError);
  }
});
