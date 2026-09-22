import { useEffect, useLayoutEffect, useState } from "react";
import { Deck, type Slide } from "./presentation/Deck";
import { insertRoutingDemos } from "./presentation/slide-order";
import { RealRoutingSlide } from "./slides/RealRoutingSlide";
import { HardwareSetup, type ConnectionRow } from "./zwave/HardwareSetup";
import { hardware, jammerRcpIds, type HardwareKind } from "./zwave/hardware";
import { liveNetwork, useLiveNetwork } from "./zwave/live-network";
import { errorMessage } from "./zwave/priority-route";
import { SecurityKeysForm } from "./zwave/SecurityKeysForm";
import { ConnectionsContext } from "./presentation/ConnectionsContext";
import { getSetupStatus } from "./zwave/setup-status";
import { requiredRegion, requiredZnifferChannels } from "./zwave/radio-config";
import { loadSecurityKeys, saveSecurityKeys, withSecurityKeyDefaults } from "./zwave/security-store";
import { BeamingSlide } from "./slides/BeamingSlide";
import { RcpControlSlide } from "./slides/RcpControlSlide";
import { NetworkJammingSlide } from "./slides/NetworkJammingSlide";
import { networkJammer } from "./zwave/network-jammer";
import { BeamJammingSlide } from "./slides/BeamJammingSlide";
import { beamJammer } from "./zwave/beam-jammer";
import { ReturnRouteRelaySlide } from "./slides/ReturnRouteRelaySlide";
import { QuestionsSlide } from "./slides/QuestionsSlide";
import { MitigationsSlide } from "./slides/MitigationsSlide";
import { findSavedSerialPort, loadSerialSelections, saveSerialSelection } from "./zwave/serial-store";

const fallbackSecurityKeys = import.meta.env.VITE_ZWAVE_SECURITY_KEYS;

export function PresentationApp({ slides }: { slides: Slide[] }) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [rcps, setRcps] = useState<string[]>([...jammerRcpIds]);
  const [nextRcp, setNextRcp] = useState(4);
  const [setupError, setSetupError] = useState("");
  const [interviewNotice, setInterviewNotice] = useState("");
  const [securityLoaded, setSecurityLoaded] = useState(false);
  const live = useLiveNetwork();
  useLayoutEffect(() => {
    hardware.setCaptureForwarding(!setupOpen);
    if (setupOpen) {
      void networkJammer.stop();
      void beamJammer.stop();
    }
    return () => hardware.setCaptureForwarding(false);
  }, [setupOpen]);
  const setup = getSetupStatus(live.hardware);
  const securityLocked = live.hardware.mainBusy || live.hardware.connections.some(connection =>
    connection.kind !== "rcp" && (connection.hasInstance || !["disconnected", "error"].includes(connection.status)));
  useEffect(() => {
    try {
      const saved = loadSecurityKeys(window.localStorage, fallbackSecurityKeys);
      if (saved) hardware.configureSecurity(saved);
      setSecurityLoaded(true);
    } catch (error) {
      setSetupError(`Could not restore network keys: ${errorMessage(error)}`);
    }
  }, []);
  useEffect(() => {
    const serial = typeof navigator === "undefined" ? undefined : navigator.serial;
    if (!serial) return;
    let cancelled = false;
    const restore = async () => {
      try {
        const selections = loadSerialSelections(window.localStorage);
        const ports = await serial.getPorts();
        const failures: string[] = [];
        for (const selection of selections) {
          if (cancelled) return;
          const port = findSavedSerialPort(selection, ports);
          if (!port) {
            failures.push(`${selection.kind} ${selection.id} is no longer available`);
            continue;
          }
          try {
            await hardware.restoreConnection(selection.kind, selection.id, port);
          } catch (error) {
            failures.push(`${selection.kind} ${selection.id}: ${errorMessage(error)}`);
          }
        }
        if (!cancelled && failures.length) setSetupError(`Could not restore saved serial devices: ${failures.join(". ")}`);
      } catch (error) {
        if (!cancelled) setSetupError(`Could not restore saved serial devices: ${errorMessage(error)}`);
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const serial = typeof navigator === "undefined" ? undefined : navigator.serial;
    if (!serial) return;
    return hardware.subscribePortSelections((kind, id, port) => {
      void serial.getPorts()
        .then(ports => saveSerialSelection(window.localStorage, kind, id, port, ports))
        .catch(error => setSetupError(`Could not save serial selection: ${errorMessage(error)}`));
    });
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
      remove: entry.kind === "rcp" && !jammerRcpIds.includes(entry.id as typeof jammerRcpIds[number])
        ? () => attempt(removeRcp(entry.id)) : undefined,
      reinterview: entry.kind === "main" ? () => attempt(reinterviewAll()) : undefined,
      canReinterview: !!hardware.getMainDriver() && !live.cleanupRequired,
    };
  });
  const routingDemo = (id: string, title: string): Slide => ({
    id,
    title,
    notes: "Real network. Node 002 is a Binary Switch plug. Direct sets an empty priority route; routed uses node 003. A real Zniffer supplies the lane view. Each action clears the priority route afterward.",
    content: <RealRoutingSlide title={title} frames={live.capture.frames} nodes={live.nodes} ready={live.ready}
      busy={live.busy} on={live.on} outcome={live.outcome}
      cleanupRequired={live.cleanupRequired} onAction={liveNetwork.action} onClearRoute={liveNetwork.clearRoute}
      onClearCapture={liveNetwork.clearCapture}
      canClearRoute={!!hardware.getMainDriver()} />,
  });
  const presentation = insertRoutingDemos(slides,
    routingDemo("live-routing", "Let's see it in action"),
    routingDemo("live-routing-explorers", "Let's see it in action once more"),
    {
      id: "live-beaming",
      title: "So anyway, I started blasting",
      notes: "The RCP sends raw beam frames toward nonexistent Classic node 004. Start beaming runs until stopped. The preset buttons show short, long, and fragmented beam timing in the live tinySA waterfall.",
      content: <BeamingSlide />,
    },
    {
      id: "live-rcp-control",
      title: "Do i know you?",
      notes: "RCP-1 sends raw direct frames on the main network. It impersonates node 001 for plug commands and node 003 for Multilevel Switch reports. The Zniffer shows the command and any direct ACK.",
      content: <RcpControlSlide frames={live.capture.frames} nodes={live.nodes} ready={setup.ready && !live.busy}
        onClearCapture={liveNetwork.clearCapture} />,
    },
    {
      id: "live-jamming",
      title: "9.6 kbit/s, that's my jam!",
      notes: "Three RCPs send 64-byte frames at 9.6 kbit/s toward an absent node. Their 30 ms offsets and 90 ms cycles keep at least one jammer transmitting. The main controller then tries direct 100 kbit/s plug commands. Jammer frames are filtered from the trace. Press the LR device button and compare the received count before and during flooding.",
      content: <NetworkJammingSlide frames={live.capture.frames}
        ready={setup.ready} busy={live.busy} cleanupRequired={live.cleanupRequired}
        on={live.on} outcome={live.outcome}
        lrPresses={live.lrPresses}
        lrReady={!!live.hardware.connections.find(connection => connection.kind === "main")
          ?.nodes.some(node => node.id === 256 && node.ready)}
        onPlugAction={(action, speed) => void liveNetwork.action(action, false, speed)}
        onClearCapture={liveNetwork.clearCapture}
        onResetLrPresses={liveNetwork.resetLrPresses} />,
    },
    {
        id: "live-beam-jamming",
        title: "Master Blaster (Jammin')",
        notes: "Three RCPs send 1100 ms Classic 40 kbit/s beams toward absent node 007. RCP-1, RCP-2, and RCP-3 transmit one at a time with no intentional gap. The tinySA waterfall shows each beam. Try the plug or press the LR device button during the sequence.",
        content: <BeamJammingSlide frames={live.capture.frames} ready={setup.ready} busy={live.busy}
          cleanupRequired={live.cleanupRequired} on={live.on} outcome={live.outcome}
          lrPresses={live.lrPresses}
          lrReady={!!live.hardware.connections.find(connection => connection.kind === "main")
            ?.nodes.some(node => node.id === 256 && node.ready)}
          onPlugAction={(action, speed) => void liveNetwork.action(action, false, speed)}
          onClearCapture={liveNetwork.clearCapture}
          onResetLrPresses={liveNetwork.resetLrPresses} />,
    },
    {
      id: "live-return-route-relay",
      title: "Who's in the middle?",
      notes: "A priority SUC return route takes node 003 through RCP-2 as node 005 and RCP-1 as node 004 to controller node 001. In forward mode the report is relayed all the way to the controller. In drop mode node 005 still forwards the report to node 004, which silently drops it, then a forged final-hop routed acknowledgement is returned to node 003 so it does not retry.",
      content: <ReturnRouteRelaySlide frames={live.capture.frames} nodes={live.nodes} ready={setup.ready && !live.busy}
        onClearCapture={liveNetwork.clearCapture} />,
    });
  presentation.push({ id: "mitigations", title: "What can be done about it?", notes: "Encrypting the application layer, supervised requests, and encrypting the network layer all raise the bar against these attacks.", content: <MitigationsSlide /> });
  presentation.push({ id: "questions", title: "Questions?", notes: "Open the floor. Offer to run any live demo scenario again.", content: <QuestionsSlide /> });
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
        hasDefaults={!!fallbackSecurityKeys}
        onApply={options => {
          hardware.configureSecurity(withSecurityKeyDefaults(options, fallbackSecurityKeys));
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
