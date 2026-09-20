import { useEffect, useRef, useState } from "react";
import type { DemoFrame, Outcome } from "../demo/types";
import { Button, OutcomeIndicator, SegmentedControl } from "../components/controls";
import { FrameLog } from "../components/zniffer";
import { Corners, SlideFrame } from "../presentation/SlideFrame";
import type { DemoSpeed, PlugAction } from "../zwave/priority-route";
import { beamJammer, useBeamJammer } from "../zwave/beam-jammer";
import { ReceiverPanel } from "./ReceiverPanel";
import "./beam-jamming.css";

export interface BeamJammingSlideProps {
  frames: readonly DemoFrame[];
  ready: boolean;
  busy: boolean;
  cleanupRequired: boolean;
  on: boolean | undefined;
  outcome: Outcome;
  lrPresses: number;
  lrReady: boolean;
  onPlugAction(action: PlugAction, speed: DemoSpeed): void;
  onClearCapture(): void;
  onResetLrPresses(): void;
}

export function BeamJammingSlide(props: BeamJammingSlideProps) {
  const jammer = useBeamJammer();
  const root = useRef<HTMLElement>(null);
  const [speed, setSpeed] = useState<DemoSpeed>("100k");
  const plugDisabled = !props.ready || props.busy || props.cleanupRequired;

  useEffect(() => {
    const slot = root.current?.closest(".slide-slot");
    if (!slot) return;
    const observer = new MutationObserver(() => {
      if (!slot.hasAttribute("data-deck-active")) void beamJammer.stop();
    });
    observer.observe(slot, { attributes: true, attributeFilter: ["data-deck-active"] });
    return () => {
      observer.disconnect();
      void beamJammer.stop();
    };
  }, []);

  return (
    <SlideFrame title="Master Blaster (Jammin')">
      <section ref={root} className="beam-jam-controls figure-frame" data-deck-interactive>
        <Corners />
        <div className="beam-jam-section">
          <h3>RCP-1 → RCP-2 → RCP-3</h3>
          <p>1100 ms beams · 40 kbit/s · continuous handoff</p>
          <div className="beam-jam-actions">
            <Button primary disabled={!props.ready || jammer.active}
              onClick={() => void beamJammer.start()}>Start beaming</Button>
            <Button disabled={!jammer.active} onClick={() => void beamJammer.stop()}>Stop</Button>
          </div>
          <OutcomeIndicator compact outcome={jammer.error
            ? { kind: "error", label: jammer.error }
            : jammer.active
              ? {
                kind: "pending",
                label: `${jammer.activeRcpId?.toUpperCase() ?? "RCP"} active · ${jammer.beamsCompleted} completed`,
              }
              : { kind: "idle", label: "Beam jamming stopped" }} />
        </div>

        <div className="beam-jam-section">
          <h3>Try the plug · node 002</h3>
          <div className="beam-jam-plug-actions">
            <SegmentedControl label="Plug power" value={props.on === undefined ? "" : props.on ? "on" : "off"}
              options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]}
              disabled={plugDisabled} onChange={value => props.onPlugAction(value as PlugAction, speed)} />
            <Button disabled={plugDisabled} onClick={() => props.onPlugAction("ping", speed)}>PING</Button>
          </div>
          <SegmentedControl label="Requested data rate" value={speed}
            options={[{ value: "9.6k", label: "9.6k" }, { value: "40k", label: "40k" }, { value: "100k", label: "100k" }]}
            disabled={plugDisabled} onChange={setSpeed} />
          {props.outcome.kind !== "idle" && <OutcomeIndicator compact outcome={props.outcome} />}
        </div>

        <div className="beam-jam-section beam-jam-lr-counter">
          <div>
            <h3>LR button · node 256</h3>
            <p>{props.lrReady ? "Presses received by the controller" : "Node 256 is unavailable"}</p>
          </div>
          <strong>{props.lrPresses}</strong>
          <Button disabled={!props.lrPresses} onClick={props.onResetLrPresses}>Reset</Button>
        </div>
      </section>

      <div className="beam-jam-trace">
        <FrameLog frames={props.frames} variant="compact" title="Zniffer" showFrameCount={false}
          onClear={props.onClearCapture} />
      </div>
      <div className="beam-jam-waterfall"><ReceiverPanel /></div>
    </SlideFrame>
  );
}
