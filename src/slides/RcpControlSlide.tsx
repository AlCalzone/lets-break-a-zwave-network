import { useState } from "react";
import type { DemoFrame, DemoNode, Outcome } from "../demo/types";
import { Button, OutcomeIndicator } from "../components/controls";
import { LaneView } from "../components/zniffer";
import { Corners, SlideFrame } from "../presentation/SlideFrame";
import { rcpCommands, type RcpCommand } from "../zwave/rcp-commands";
import "./rcp-control.css";

export interface RcpControlSlideProps {
  frames: readonly DemoFrame[];
  nodes: readonly DemoNode[];
  ready: boolean;
  onClearCapture(): void;
}

export function RcpControlSlide({ frames, nodes, ready, onClearCapture }: RcpControlSlideProps) {
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState(50);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle", label: "" });

  async function send(command: RcpCommand) {
    if (busy) return;
    setBusy(true);
    setOutcome({ kind: "pending", label: "Sending from RCP-1" });
    onClearCapture();
    try {
      const label = await rcpCommands.send(command, level);
      setOutcome({ kind: "success", label });
    } catch (error) {
      setOutcome({ kind: "error", label: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SlideFrame title="Do i know you?">
      <section className="rcp-control-panel figure-frame" data-deck-interactive aria-busy={busy}>
        <Corners />
        <div className="zc-head">
          <span className="zc-id"><b>RCP-1</b> Raw frame controls</span>
        </div>

        <div className="rcp-control-group">
          <h3>Plug · node 002</h3>
          <div className="rcp-control-actions">
            <Button disabled={!ready || busy} onClick={() => void send("plug-on")}>ON</Button>
            <Button disabled={!ready || busy} onClick={() => void send("plug-off")}>OFF</Button>
            <Button disabled={!ready || busy} onClick={() => void send("plug-ping")}>PING</Button>
          </div>
        </div>

        <div className="rcp-control-group">
          <h3>Dimmer report · node 003 → 001</h3>
          <label className="rcp-level">
            <span>Current value</span>
            <output>{level}%</output>
            <input type="range" min="0" max="99" value={level} disabled={busy}
              onChange={event => setLevel(Number(event.currentTarget.value))} />
          </label>
          <Button wide disabled={!ready || busy} onClick={() => void send("multilevel-report")}>
            Send Multilevel Switch report
          </Button>
        </div>

        {outcome.kind !== "idle" && <OutcomeIndicator outcome={outcome} />}
      </section>

      <div className="rcp-control-lanes">
        <LaneView frames={frames} nodes={nodes} onClear={onClearCapture} fixedNodes />
      </div>
    </SlideFrame>
  );
}
