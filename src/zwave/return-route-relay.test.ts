import assert from "node:assert/strict";
import test from "node:test";
import {
  MPDU,
  MPDUHeaderType,
  ProtocolDataRate,
  RFRegion,
  RoutedZWaveMPDU,
} from "@zwave-js/core";
import { FAKE_REPEATER_NODE_ID, SECOND_FAKE_REPEATER_NODE_ID } from "./network";
import {
  canRelayFrame,
  forgeRoutedAck,
  forwardRelayFrame,
  returnRouteCommandSpec,
  shouldForwardRelayFrame,
} from "./return-route-relay";

const radio = {
  channel: 0,
  dataRate: ProtocolDataRate.ZWave_100k,
  region: RFRegion["Europe (Long Range)"],
};

test("the SUC route uses both fake relays and selects that route with priority", () => {
  assert.deepEqual([...returnRouteCommandSpec("route-via-fakes").payload], [0x01, 0x14, 0x01, 0x02, 0x05, 0x04, 0x20]);
  assert.deepEqual([...returnRouteCommandSpec("prioritize-route").payload], [0x01, 0x25, 0x01, 0x00]);
});

test("return-route teardown restores the direct SUC route", () => {
  assert.deepEqual([...returnRouteCommandSpec("route-direct").payload], [0x01, 0x14, 0x01, 0x00, 0x20]);
});

test("node 005 forwards to node 004 and controls report delivery", () => {
  const inbound = new RoutedZWaveMPDU({
    homeId: 0x12345678,
    sourceNodeId: 3,
    destinationNodeId: 1,
    ackRequested: false,
    headerType: MPDUHeaderType.Singlecast,
    sequenceNumber: 5,
    payload: Uint8Array.from([0x26, 0x03, 0x41]),
    routed: true,
    direction: "outbound",
    routedAck: false,
    routedError: false,
    hop: 0,
    repeaters: [SECOND_FAKE_REPEATER_NODE_ID, FAKE_REPEATER_NODE_ID],
  });
  assert.equal(canRelayFrame(inbound, SECOND_FAKE_REPEATER_NODE_ID), true);
  assert.equal(shouldForwardRelayFrame(inbound, SECOND_FAKE_REPEATER_NODE_ID, "drop"), true);
  const forwarded = forwardRelayFrame(inbound, -72);
  assert.equal(forwarded.hop, 1);
  assert.deepEqual(forwarded.repeaters, [SECOND_FAKE_REPEATER_NODE_ID, FAKE_REPEATER_NODE_ID]);
  assert.equal(canRelayFrame(forwarded, FAKE_REPEATER_NODE_ID), true);
  assert.equal(shouldForwardRelayFrame(forwarded, FAKE_REPEATER_NODE_ID, "forward"), true);
  assert.equal(shouldForwardRelayFrame(forwarded, FAKE_REPEATER_NODE_ID, "drop"), false);
  const parsed = MPDU.parse(forwarded.serialize({
    channel: radio.channel,
    protocolDataRate: radio.dataRate,
    region: radio.region,
  }), {
    channel: radio.channel,
    protocolDataRate: radio.dataRate,
    region: radio.region,
  });
  assert.ok(parsed instanceof RoutedZWaveMPDU);
  assert.equal(parsed.hop, 1);
  assert.equal(canRelayFrame(parsed, FAKE_REPEATER_NODE_ID), true);
});

test("both relays forward inbound routed acknowledgements back to the dimmer", () => {
  const acknowledgement = new RoutedZWaveMPDU({
    homeId: 0x12345678,
    sourceNodeId: 1,
    destinationNodeId: 3,
    ackRequested: false,
    headerType: MPDUHeaderType.Singlecast,
    sequenceNumber: 5,
    routed: true,
    direction: "inbound",
    routedAck: true,
    routedError: false,
    hop: 2,
    repeaters: [SECOND_FAKE_REPEATER_NODE_ID, FAKE_REPEATER_NODE_ID],
  });
  assert.equal(canRelayFrame(acknowledgement, FAKE_REPEATER_NODE_ID), true);
  assert.equal(shouldForwardRelayFrame(acknowledgement, FAKE_REPEATER_NODE_ID, "drop"), true);
  const fromNode4 = forwardRelayFrame(acknowledgement, -72);
  assert.equal(fromNode4.hop, 1);
  assert.equal(canRelayFrame(fromNode4, SECOND_FAKE_REPEATER_NODE_ID), true);
  const fromNode5 = forwardRelayFrame(fromNode4, -70);
  assert.equal(fromNode5.hop, 0);
  assert.equal(fromNode5.ackRequested, true);
});

test("RCP-2 forges the final-hop routed acknowledgement when a report is dropped", () => {
  const report = new RoutedZWaveMPDU({
    homeId: 0x12345678,
    sourceNodeId: 3,
    destinationNodeId: 1,
    ackRequested: false,
    headerType: MPDUHeaderType.Singlecast,
    sequenceNumber: 5,
    payload: Uint8Array.from([0x26, 0x03, 0x41]),
    routed: true,
    direction: "outbound",
    routedAck: false,
    routedError: false,
    hop: 0,
    repeaters: [SECOND_FAKE_REPEATER_NODE_ID, FAKE_REPEATER_NODE_ID],
  });
  const acknowledgement = forgeRoutedAck(report);
  assert.equal(acknowledgement.sourceNodeId, 1);
  assert.equal(acknowledgement.destinationNodeId, 3);
  assert.equal(acknowledgement.direction, "inbound");
  assert.equal(acknowledgement.routedAck, true);
  assert.equal(acknowledgement.hop, 0);
  assert.equal(acknowledgement.ackRequested, true);
  assert.deepEqual(acknowledgement.repeaters, [SECOND_FAKE_REPEATER_NODE_ID, FAKE_REPEATER_NODE_ID]);
  const parsed = MPDU.parse(acknowledgement.serialize({
    channel: radio.channel,
    protocolDataRate: radio.dataRate,
    region: radio.region,
  }), {
    channel: radio.channel,
    protocolDataRate: radio.dataRate,
    region: radio.region,
  });
  assert.ok(parsed instanceof RoutedZWaveMPDU);
  assert.equal(parsed.routedAck, true);
  assert.equal(parsed.hop, 0);
  assert.deepEqual([...parsed.payload], []);
});
