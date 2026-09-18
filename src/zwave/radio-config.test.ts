import assert from "node:assert/strict";
import test from "node:test";
import { ChannelConfiguration, RFRegion } from "@zwave-js/core";
import { configureRcpRadio, configureZnifferRadio, requiredRegion, requiredRcpChannels, requiredZnifferChannels, requiredZnifferRegion, verifyMainRadio } from "./radio-config";

test("main radio requires a hardware readback of EU Long Range", async () => {
  assert.deepEqual(await verifyMainRadio({ async getRFRegion() { return requiredRegion; } }), { rfRegion: requiredRegion });
  await assert.rejects(verifyMainRadio({ async getRFRegion() { return RFRegion.Europe; } }), /did not confirm EU Long Range/);
  await assert.rejects(verifyMainRadio({ async getRFRegion() { throw new Error("Query failed"); } }), /Query failed/);
});

function zniffer() {
  const calls: string[] = [];
  const radio = {
    currentFrequency: 0, currentLRChannelConfig: 0,
    supportedFrequencies: new Map<number, string>([[requiredZnifferRegion, "EU Long Range"]]),
    supportedLRChannelConfigs: new Map<number, string>([[requiredZnifferChannels, "Classic + LR A"]]),
    async setFrequency(value: number) { calls.push("region"); this.currentFrequency = value; },
    async setLRChannelConfig(value: number) { calls.push("channels"); this.currentLRChannelConfig = value; },
  };
  return { radio, calls };
}

test("Zniffer configures region before Classic plus LR A and keeps matching settings", async () => {
  const { radio, calls } = zniffer();
  assert.deepEqual(await configureZnifferRadio(radio), { rfRegion: requiredZnifferRegion, channelConfig: requiredZnifferChannels });
  assert.deepEqual(calls, ["region", "channels"]);
  calls.length = 0;
  await configureZnifferRadio(radio);
  assert.deepEqual(calls, []);
});

test("unsupported Zniffer region or channel configuration cannot become ready", async () => {
  const { radio } = zniffer();
  radio.supportedFrequencies.clear();
  await assert.rejects(configureZnifferRadio(radio), /does not support EU Long Range/);
  const other = zniffer().radio;
  other.supportedLRChannelConfigs.clear();
  await assert.rejects(configureZnifferRadio(other), /does not support Classic \+ LR A/);
  const unconfirmed = zniffer().radio;
  unconfirmed.setLRChannelConfig = async () => {};
  await assert.rejects(configureZnifferRadio(unconfirmed), /did not confirm/);
});

test("RCP region changes require matching readback", async () => {
  const state = { region: RFRegion.Europe, channelConfig: ChannelConfiguration.Classic, channels: [] };
  let queries = 0;
  const rcp = {
    async queryRegion() { queries++; return state; },
    async setRegion(region: RFRegion, channelConfig: ChannelConfiguration) {
      Object.assign(state, { region, channelConfig });
      return [];
    },
  };
  assert.deepEqual(await configureRcpRadio(rcp), { rfRegion: requiredRegion, channelConfig: requiredRcpChannels });
  assert.equal(queries, 2);
  Object.assign(state, { region: RFRegion.Europe });
  rcp.setRegion = async () => [];
  await assert.rejects(configureRcpRadio(rcp), /did not confirm EU Long Range/);
});
