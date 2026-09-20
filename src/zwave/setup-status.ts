import { jammerRcpIds, type HardwareKind, type HardwareSnapshot } from "./hardware";
import { requiredRcpChannels, requiredRegion, requiredZnifferChannels } from "./radio-config";

export const requiredHardware: readonly HardwareKind[] = ["main", "zniffer", "rcp"];

export function getSetupStatus(snapshot: HardwareSnapshot) {
  const missing = requiredHardware.filter(kind => !snapshot.connections.some(connection =>
    connection.kind === kind && connection.status === "ready" && !connection.error
    && connection.rfRegion === requiredRegion
    && (kind === "main" || connection.channelConfig === (kind === "rcp" ? requiredRcpChannels : requiredZnifferChannels))
    && (kind !== "zniffer" || connection.capturing)));
  const missingRcps = jammerRcpIds.filter(id => !snapshot.connections.some(connection =>
    connection.kind === "rcp" && connection.id === id && connection.status === "ready" && !connection.error
    && connection.rfRegion === requiredRegion && connection.channelConfig === requiredRcpChannels));
  const reason = !snapshot.supported ? "Web Serial is unavailable."
    : missing.includes("main") ? "Connect the main controller with EU Long Range."
    : missing.includes("zniffer") ? "Connect the Zniffer with EU Long Range / Classic + LR A."
    : missing.includes("rcp") || missingRcps.length ? `Connect ${missingRcps.join(", ") || "the required RCPs"}.`
    : "";
  return { ready: !reason, reason };
}
