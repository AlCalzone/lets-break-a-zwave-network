import assert from "node:assert/strict";
import test from "node:test";
import type { HardwareConnection, HardwareSnapshot } from "./hardware";
import { getSetupStatus } from "./setup-status";
import { requiredRcpChannels, requiredRegion, requiredZnifferChannels } from "./radio-config";

const main: HardwareConnection = { kind: "main", id: "main", status: "ready", hasInstance: true, nodes: [], capturing: false, rfRegion: requiredRegion };
const zniffer: HardwareConnection = { kind: "zniffer", id: "zniffer", status: "ready", hasInstance: true, nodes: [], capturing: true, rfRegion: requiredRegion, channelConfig: requiredZnifferChannels };
const rcp = (id: string): HardwareConnection => ({
  kind: "rcp", id, status: "ready", hasInstance: true, nodes: [], capturing: false,
  rfRegion: requiredRegion, channelConfig: requiredRcpChannels,
});
const rcps = [rcp("rcp-1"), rcp("rcp-2"), rcp("rcp-3")];
const snapshot = (connections: HardwareConnection[]): HardwareSnapshot => ({
  supported: true, mainBusy: false, configuredSecurityKeys: [], connections,
});

test("setup requires a ready controller, capturing Zniffer, and shared RCP", () => {
  for (const connections of [[], [main], [zniffer], [main, zniffer], [main, { ...zniffer, capturing: false }, ...rcps]]) {
    assert.equal(getSetupStatus(snapshot(connections)).ready, false);
  }
  assert.equal(getSetupStatus(snapshot([main, zniffer, ...rcps])).ready, true);
});

test("setup loses readiness on disconnection or error", () => {
  for (const status of ["disconnected", "selecting", "connecting", "disconnecting", "error"] as const) {
    assert.equal(getSetupStatus(snapshot([{ ...main, status }, zniffer, ...rcps])).ready, false);
    assert.equal(getSetupStatus(snapshot([main, { ...zniffer, status }, ...rcps])).ready, false);
    assert.equal(getSetupStatus(snapshot([main, zniffer, { ...rcps[0], status }, rcps[1], rcps[2]])).ready, false);
  }
  assert.equal(getSetupStatus(snapshot([{ ...main, error: "USB failure" }, zniffer, ...rcps])).ready, false);
  assert.equal(getSetupStatus({ ...snapshot([main, zniffer, ...rcps]), supported: false }).ready, false);
});

test("all three shared RCPs satisfy the demo requirement", () => {
  assert.equal(getSetupStatus(snapshot([main, zniffer, ...rcps])).ready, true);
  assert.equal(getSetupStatus(snapshot([main, zniffer, rcps[0], rcps[1]])).ready, false);
});

test("setup requires confirmed EU Long Range and Classic plus LR A", () => {
  assert.equal(getSetupStatus(snapshot([{ ...main, rfRegion: undefined }, zniffer, ...rcps])).ready, false);
  assert.equal(getSetupStatus(snapshot([{ ...main, rfRegion: 0 }, zniffer, ...rcps])).ready, false);
  assert.equal(getSetupStatus(snapshot([main, { ...zniffer, rfRegion: 0 }, ...rcps])).ready, false);
  assert.equal(getSetupStatus(snapshot([main, { ...zniffer, channelConfig: 2 }, ...rcps])).ready, false);
  assert.equal(getSetupStatus(snapshot([main, zniffer, { ...rcps[0], channelConfig: 2 }, rcps[1], rcps[2]])).ready, false);
});
