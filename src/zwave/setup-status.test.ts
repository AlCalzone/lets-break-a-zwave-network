import assert from "node:assert/strict";
import test from "node:test";
import type { HardwareConnection, HardwareSnapshot } from "./hardware";
import { getSetupStatus } from "./setup-status";
import { requiredRegion, requiredZnifferChannels } from "./radio-config";

const main: HardwareConnection = { kind: "main", id: "main", status: "ready", hasInstance: true, nodes: [], capturing: false, rfRegion: requiredRegion };
const zniffer: HardwareConnection = { kind: "zniffer", id: "zniffer", status: "ready", hasInstance: true, nodes: [], capturing: true, rfRegion: requiredRegion, channelConfig: requiredZnifferChannels };
const snapshot = (connections: HardwareConnection[]): HardwareSnapshot => ({
  supported: true, mainBusy: false, configuredSecurityKeys: [], connections,
});

test("setup requires a ready controller and a capturing Zniffer", () => {
  for (const connections of [[], [main], [zniffer], [main, { ...zniffer, capturing: false }]]) {
    assert.equal(getSetupStatus(snapshot(connections)).ready, false);
  }
  assert.equal(getSetupStatus(snapshot([main, zniffer])).ready, true);
});

test("setup loses readiness on disconnection or error", () => {
  for (const status of ["disconnected", "selecting", "connecting", "disconnecting", "error"] as const) {
    assert.equal(getSetupStatus(snapshot([{ ...main, status }, zniffer])).ready, false);
    assert.equal(getSetupStatus(snapshot([main, { ...zniffer, status }])).ready, false);
  }
  assert.equal(getSetupStatus(snapshot([{ ...main, error: "USB failure" }, zniffer])).ready, false);
  assert.equal(getSetupStatus({ ...snapshot([main, zniffer]), supported: false }).ready, false);
});

test("RCPs and node interviews do not change the current setup requirements", () => {
  assert.equal(getSetupStatus(snapshot([main, zniffer, { ...main, kind: "rcp", id: "rcp-1", status: "error" }])).ready, true);
});

test("setup requires confirmed EU Long Range and Classic plus LR A", () => {
  assert.equal(getSetupStatus(snapshot([{ ...main, rfRegion: undefined }, zniffer])).ready, false);
  assert.equal(getSetupStatus(snapshot([{ ...main, rfRegion: 0 }, zniffer])).ready, false);
  assert.equal(getSetupStatus(snapshot([main, { ...zniffer, rfRegion: 0 }])).ready, false);
  assert.equal(getSetupStatus(snapshot([main, { ...zniffer, channelConfig: 2 }])).ready, false);
});
