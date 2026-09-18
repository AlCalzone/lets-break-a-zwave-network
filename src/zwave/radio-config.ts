import { ChannelConfiguration, RFRegion, ZnifferLRChannelConfig, ZnifferRegion } from "@zwave-js/core";
import type { Driver, RCPHost, Zniffer } from "./hardware";

export const requiredRegion = RFRegion["Europe (Long Range)"];
export const requiredZnifferRegion = ZnifferRegion["Europe (Long Range)"];
export const requiredZnifferChannels = ZnifferLRChannelConfig["Classic & LR A"];
export const requiredRcpChannels = ChannelConfiguration["Classic & LR A"];

export async function verifyMainRadio(controller: Pick<Driver["controller"], "getRFRegion">) {
  const region = await controller.getRFRegion();
  if (region !== requiredRegion) throw new Error("The controller did not confirm EU Long Range. Check its firmware and region support.");
  return { rfRegion: region };
}

export async function configureZnifferRadio(zniffer: Pick<Zniffer,
  "supportedFrequencies" | "supportedLRChannelConfigs" | "currentFrequency" | "currentLRChannelConfig" | "setFrequency" | "setLRChannelConfig">) {
  if (!zniffer.supportedFrequencies.has(requiredZnifferRegion)) throw new Error("This Zniffer does not support EU Long Range.");
  if (!zniffer.supportedLRChannelConfigs.has(requiredZnifferChannels)) throw new Error("This Zniffer does not support Classic + LR A.");
  if (zniffer.currentFrequency !== requiredZnifferRegion) await zniffer.setFrequency(requiredZnifferRegion);
  if (zniffer.currentLRChannelConfig !== requiredZnifferChannels) await zniffer.setLRChannelConfig(requiredZnifferChannels);
  if (zniffer.currentFrequency !== requiredZnifferRegion || zniffer.currentLRChannelConfig !== requiredZnifferChannels) {
    throw new Error("The Zniffer did not confirm EU Long Range / Classic + LR A.");
  }
  return { rfRegion: zniffer.currentFrequency, channelConfig: zniffer.currentLRChannelConfig };
}

export async function configureRcpRadio(rcp: Pick<RCPHost, "queryRegion" | "setRegion">) {
  let config = await rcp.queryRegion();
  if (config.region !== requiredRegion || config.channelConfig !== requiredRcpChannels) {
    await rcp.setRegion(requiredRegion, requiredRcpChannels);
    config = await rcp.queryRegion();
  }
  if (config.region !== requiredRegion || config.channelConfig !== requiredRcpChannels) {
    throw new Error("The RCP did not confirm EU Long Range / Classic + LR A.");
  }
  return { rfRegion: config.region, channelConfig: config.channelConfig };
}
