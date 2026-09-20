import assert from "node:assert/strict";
import test from "node:test";
import { MPDU, ProtocolDataRate, RFRegion, SinglecastZWaveMPDU } from "@zwave-js/core";
import { rcpCommandSpec, selectRcpCommandChannel, encodeRcpCommand } from "./rcp-commands";

const radio = {
  channel: 0,
  dataRate: ProtocolDataRate.ZWave_100k,
  region: RFRegion["Europe (Long Range)"],
};

test("plug commands impersonate the controller and contain the expected command", () => {
  assert.deepEqual([...rcpCommandSpec("plug-on").payload], [0x25, 0x01, 0xff]);
  assert.deepEqual([...rcpCommandSpec("plug-off").payload], [0x25, 0x01, 0x00]);
  assert.deepEqual([...rcpCommandSpec("plug-ping").payload], [0x00]);
  for (const command of ["plug-on", "plug-off", "plug-ping"] as const) {
    const spec = rcpCommandSpec(command);
    assert.equal(spec.sourceNodeId, 1);
    assert.equal(spec.destinationNodeId, 2);
  }
});

test("Multilevel Switch reports impersonate the dimmer", () => {
  const spec = rcpCommandSpec("multilevel-report", 73);
  assert.equal(spec.sourceNodeId, 3);
  assert.equal(spec.destinationNodeId, 1);
  assert.deepEqual([...spec.payload], [0x26, 0x03, 73]);
  assert.throws(() => rcpCommandSpec("multilevel-report", 100), RangeError);
});

test("RCP commands prefer the Classic 100 kbit/s channel", () => {
  const channels = [
    { channel: 1, dataRate: ProtocolDataRate.ZWave_40k },
    { channel: 0, dataRate: ProtocolDataRate.ZWave_100k },
  ];
  assert.equal(selectRcpCommandChannel(channels), channels[1]);
});

test("encoded RCP commands are acknowledged direct singlecasts", () => {
  const frame = encodeRcpCommand(rcpCommandSpec("plug-on"), 0x12345678, 7, radio);
  const parsed = MPDU.parse(frame, {
    channel: radio.channel,
    protocolDataRate: radio.dataRate,
    region: radio.region,
  });
  assert.ok(parsed instanceof SinglecastZWaveMPDU);
  assert.equal(parsed.homeId, 0x12345678);
  assert.equal(parsed.sourceNodeId, 1);
  assert.equal(parsed.destinationNodeId, 2);
  assert.equal(parsed.sequenceNumber, 7);
  assert.equal(parsed.ackRequested, true);
  assert.deepEqual([...parsed.payload], [0x25, 0x01, 0xff]);
});
