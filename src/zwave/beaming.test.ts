import assert from "node:assert/strict";
import test from "node:test";
import { ProtocolDataRate } from "@zwave-js/core";
import { beamingTargetNodeId, beamParameters, fragmentedBeamingTargetNodeId } from "./beaming";
import { primaryRcpId } from "./hardware";

const channels = [
  { channel: 0, dataRate: ProtocolDataRate.ZWave_9k6 },
  { channel: 1, dataRate: ProtocolDataRate.ZWave_40k },
  { channel: 2, dataRate: ProtocolDataRate.ZWave_100k },
  { channel: 3, dataRate: ProtocolDataRate.LongRange_100k },
];

test("the beaming demo uses a reusable RCP and a nonexistent Classic node", () => {
  assert.equal(primaryRcpId, "rcp-1");
  assert.equal(beamingTargetNodeId, 4);
  assert.equal(fragmentedBeamingTargetNodeId, 257);
});

test("continuous beam presets use the Classic 40 kbit/s channel", () => {
  assert.deepEqual(beamParameters("short", channels), {
    numFragments: 1, fragmentDurationMs: 275, fragmentPeriodMs: 275, channels: [1],
  });
  assert.deepEqual(beamParameters("long", channels), {
    numFragments: 1, fragmentDurationMs: 1100, fragmentPeriodMs: 1100, channels: [1],
  });
  assert.deepEqual(beamParameters("continuous", channels), {
    numFragments: 1, fragmentDurationMs: 65_535, fragmentPeriodMs: 65_535, channels: [1],
  });
});

test("fragmented beams use the Long Range channels", () => {
  assert.deepEqual(beamParameters("fragmented", channels), {
    numFragments: 16, fragmentDurationMs: 112, fragmentPeriodMs: 200, channels: [3],
  });
});
