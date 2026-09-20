import assert from "node:assert/strict";
import test from "node:test";
import { ProtocolDataRate } from "@zwave-js/core";
import {
  BEAM_JAMMER_DURATION_MS,
  BEAM_JAMMER_BUSY_RETRY_MS,
  BEAM_JAMMER_TARGET_NODE_ID,
  beamJammerParameters,
  selectBeamJammerChannel,
} from "./beam-jammer";

test("the beam jammer uses the Classic 40 kbit/s channel", () => {
  const channels = [
    { channel: 0, dataRate: ProtocolDataRate.ZWave_100k },
    { channel: 1, dataRate: ProtocolDataRate.ZWave_40k },
    { channel: 2, dataRate: ProtocolDataRate.ZWave_9k6 },
  ];
  assert.equal(selectBeamJammerChannel(channels), channels[1]);
});

test("the beam jammer sends one continuous 1100 ms beam toward absent node 007", () => {
  const parameters = beamJammerParameters(1);
  assert.deepEqual(parameters.channels, [1]);
  assert.equal(parameters.numFragments, 1);
  assert.equal(parameters.fragmentDurationMs, BEAM_JAMMER_DURATION_MS);
  assert.equal(parameters.fragmentPeriodMs, BEAM_JAMMER_DURATION_MS);
  assert.equal(parameters.txPower, 0);
  assert.deepEqual([...parameters.data], [0x55, BEAM_JAMMER_TARGET_NODE_ID]);
});

test("the beam jammer retries an RCP after a transient busy channel", () => {
  assert.equal(BEAM_JAMMER_BUSY_RETRY_MS, 50);
});

test("the beam jammer rejects regions without a Classic 40 kbit/s channel", () => {
  assert.throws(() => selectBeamJammerChannel([
    { channel: 2, dataRate: ProtocolDataRate.ZWave_9k6 },
  ]), /no Classic 40 kbit\/s channel/);
});
