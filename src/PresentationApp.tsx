import { useEffect, useLayoutEffect, useState } from "react";
import { Deck, type Slide } from "./presentation/Deck";
import { insertRoutingDemo } from "./presentation/slide-order";
import { RealRoutingSlide } from "./slides/RealRoutingSlide";
import { HardwareSetup, type ConnectionRow } from "./zwave/HardwareSetup";
import { hardware, type HardwareKind } from "./zwave/hardware";
import { liveNetwork, useLiveNetwork } from "./zwave/live-network";
import { errorMessage } from "./zwave/priority-route";
import { SecurityKeysForm } from "./zwave/SecurityKeysForm";
import { ConnectionsContext } from "./presentation/ConnectionsContext";
import { getSetupStatus } from "./zwave/setup-status";
import { requiredRegion, requiredZnifferChannels } from "./zwave/radio-config";
import { loadSecurityKeys, saveSecurityKeys } from "./zwave/security-store";

export function PresentationApp({ slides }: { slides: Slide[] }) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [rcps, setRcps] = useState<string[]>([]);
  const [nextRcp, setNextRcp] = useState(1);
  const [setupError, setSetupError] = useState("");
  const [interviewNotice, setInterviewNotice] = useState("");
  const [securityLoaded, setSecurityLoaded] = useState(false);
  const live = useLiveNetwork();
  useLayoutEffect(() => {
    hardware.setCaptureForwarding(!setupOpen);
    return () => hardware.setCaptureForwarding(false);
  }, [setupOpen]);
  const setup = getSetupStatus(live.hardware);
  const securityLocked = live.hardware.mainBusy || live.hardware.connections.some(connection =>
    connection.kind !== "rcp" && (connection.hasInstance || !["disconnected", "error"].includes(connection.status)));
  useEffect(() => {
    try {
      const saved = loadSecurityKeys(window.localStorage);
      if (saved) hardware.configureSecurity(saved);
      setSecurityLoaded(true);
    } catch (error) {
      setSetupError(`Could not restore network keys: ${errorMessage(error)}`);
    }
  }, []);
  useEffect(() => {
    if (!live.busy && !live.cleanupRequired) return;
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [live.busy, live.cleanupRequired]);
  const openSetup = () => setSetupOpen(true);
  const entries: { kind: HardwareKind; id: string; label: string }[] = [
    { kind: "main", id: "main", label: "Main controller · Driver" },
    { kind: "zniffer", id: "zniffer", label: "Zniffer · live radio capture" },
    ...rcps.map(id => ({ kind: "rcp" as const, id, label: `RCP · ${id}` })),
  ];
  function attempt(operation: Promise<void>) {
    setSetupError("");
    void operation.catch(error => setSetupError(errorMessage(error)));
  }
  async function removeRcp(id: string) {
    await hardware.disconnect("rcp", id);
    hardware.removeRcp(id);
    setRcps(ids => ids.filter(current => current !== id));
  }
  async function reinterviewAll() {
    setInterviewNotice("");
    const result = await hardware.reinterviewAll();
    setInterviewNotice([
      result.requested.length ? `Re-interview requested: ${result.requested.join(", ")}.` : "",
      result.inProgress.length ? `Already interviewing: ${result.inProgress.join(", ")}.` : "",
    ].filter(Boolean).join(" ") || "No nodes to re-interview.");
  }
  const rows: ConnectionRow[] = entries.map(entry => {
    const connection = live.hardware.connections.find(item => item.kind === entry.kind && item.id === entry.id);
    const status = connection?.status ?? "disconnected";
    const connected = connection?.hasInstance ?? false;
    const busy = ["selecting", "connecting", "disconnecting"].includes(status)
      || (!securityLoaded && entry.kind !== "rcp")
      || (entry.kind === "main" && (live.busy || live.hardware.mainBusy
        || (live.cleanupRequired && !!hardware.getMainDriver())));
    const nodeDetails = connection?.nodes.map(node =>
      `${String(node.id).padStart(3, "0")}: ${node.error ?? (node.interviewing ? "interviewing" : node.ready ? "ready" : "not ready")}`).join(" · ");
    const radioDetails = connection?.rfRegion === requiredRegion
      ? `EU Long Range${connection.channelConfig === requiredZnifferChannels ? " · Classic + LR A" : ""}` : "";
    return {
      ...entry,
      status,
      detail: [radioDetails, entry.kind === "main" ? nodeDetails
        : entry.kind === "zniffer" && connection?.capturing ? "Capturing" : ""].filter(Boolean).join(" · "),
      error: connection?.error,
      connected,
      busy,
      connect: () => attempt(hardware.requestConnection(entry.kind, entry.id)),
      disconnect: () => attempt(hardware.disconnect(entry.kind, entry.id)),
      remove: entry.kind === "rcp" ? () => attempt(removeRcp(entry.id)) : undefined,
      reinterview: entry.kind === "main" ? () => attempt(reinterviewAll()) : undefined,
      canReinterview: !!hardware.getMainDriver() && !live.cleanupRequired,
    };
  });
  const presentation = insertRoutingDemo(slides, {
    id: "live-routing",
    title: "Direct or through a repeater?",
    notes: "Real network. Node 002 is a Binary Switch plug. Direct sets an empty priority route; routed uses node 003. A real Zniffer supplies the lane view. Each action clears the priority route afterward.",
    content: <RealRoutingSlide frames={live.capture.frames} nodes={live.nodes} ready={live.ready}
      busy={live.busy} on={live.on} outcome={live.outcome}
      cleanupRequired={live.cleanupRequired} onAction={liveNetwork.action} onClearRoute={liveNetwork.clearRoute}
      onClearCapture={liveNetwork.clearCapture}
      canClearRoute={!!hardware.getMainDriver()} />,
  });
  const present = () => setSetupOpen(false);
  return <>
    <ConnectionsContext.Provider value={{ ready: setup.ready, open: openSetup }}>
      <Deck slides={presentation} onConfigure={openSetup} />
    </ConnectionsContext.Provider>
    {setupOpen && <HardwareSetup rows={rows} browserSupported={live.hardware.supported}
      canPresent={setup.ready && !live.busy && !live.cleanupRequired} onPresent={present} onClose={present}
      onAddRcp={() => { setRcps(ids => [...ids, `rcp-${nextRcp}`]); setNextRcp(nextRcp + 1); }}>
      {setupError && <p className="setup-error" role="alert">{setupError}</p>}
      {interviewNotice && <p role="status">{interviewNotice}</p>}
      <SecurityKeysForm disabled={securityLocked} configured={live.hardware.configuredSecurityKeys}
        onApply={options => {
          hardware.configureSecurity(options);
          saveSecurityKeys(window.localStorage, options);
          setSecurityLoaded(true);
          setSetupError("");
        }} />
      <p className="setup-note" role="status">{live.captureStatus}</p>
      {live.cleanupRequired && <div className="setup-error" role="alert">
        Priority route cleanup is required.
        <button type="button" disabled={live.busy || !hardware.getMainDriver()} onClick={() => void liveNetwork.clearRoute()}>Clear priority route</button>
      </div>}
    </HardwareSetup>}
  </>;
}
