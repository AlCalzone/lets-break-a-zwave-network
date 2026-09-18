import type { HardwareKind, HardwareSnapshot } from "./hardware";
import { requiredRegion, requiredZnifferChannels } from "./radio-config";

export const requiredHardware: readonly HardwareKind[] = ["main", "zniffer"];

export function getSetupStatus(snapshot: HardwareSnapshot) {
  const missing = requiredHardware.filter(kind => !snapshot.connections.some(connection =>
    connection.kind === kind && connection.status === "ready" && !connection.error
    && connection.rfRegion === requiredRegion
    && (kind !== "zniffer" || (connection.capturing && connection.channelConfig === requiredZnifferChannels))));
  const reason = !snapshot.supported ? "Web Serial is unavailable."
    : missing.includes("main") ? "Connect the main controller with EU Long Range."
    : missing.includes("zniffer") ? "Connect the Zniffer with EU Long Range / Classic + LR A."
    : missing.length ? "Connect the required RCP."
    : "";
  return { ready: !reason, reason };
}
