import assert from "node:assert/strict";
import test from "node:test";
import { MPDU, ProtocolDataRate, RFRegion, SinglecastZWaveMPDU } from "@zwave-js/core";
import {
  encodeJammerFrame,
  JAMMER_CYCLE_MS,
  JAMMER_FRAME_BYTES,
  JAMMER_STAGGER_MS,
  JAMMER_TARGET_NODE_ID,
  selectJammerChannel,
} from "./network-jammer";

test("jammer frames occupy 64 bytes on air and target an absent node", () => {
  const context = {
    channel: 2,
    protocolDataRate: ProtocolDataRate.ZWave_9k6,
    region: RFRegion["Europe (Long Range)"],
  };
  const frame = encodeJammerFrame({
    homeId: 0x12345678,
    sourceNodeId: 4,
    sequenceNumber: 5,
    channel: context.channel,
    region: context.region,
  });
  assert.equal(frame.length, JAMMER_FRAME_BYTES - 1);
  assert.equal(frame[7], JAMMER_FRAME_BYTES);
  const parsed = MPDU.parse(frame, context);
  assert.ok(parsed instanceof SinglecastZWaveMPDU);
  assert.equal(parsed.sourceNodeId, 4);
  assert.equal(parsed.destinationNodeId, JAMMER_TARGET_NODE_ID);
  assert.equal(parsed.ackRequested, true);
  assert.equal(parsed.payload.length, 54);
});

test("the jammer uses only the 9.6 kbit/s channel without transmission gaps", () => {
  const channels = [
    { channel: 0, dataRate: ProtocolDataRate.ZWave_100k },
    { channel: 1, dataRate: ProtocolDataRate.ZWave_40k },
    { channel: 2, dataRate: ProtocolDataRate.ZWave_9k6 },
  ];
  assert.equal(selectJammerChannel(channels), channels[2]);
  const transmissionMs = JAMMER_FRAME_BYTES * 8 / 9.6;
  assert.ok(JAMMER_STAGGER_MS < transmissionMs);
  assert.ok(JAMMER_CYCLE_MS <= transmissionMs + 2 * JAMMER_STAGGER_MS);
  assert.equal(JAMMER_CYCLE_MS, 90);
});
