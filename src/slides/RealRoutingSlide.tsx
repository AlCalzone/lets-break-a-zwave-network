import { useState } from "react";
import { Button, OutcomeIndicator, SegmentedControl } from "../components/controls";
import { LaneView } from "../components/zniffer";
import type { DemoFrame, DemoNode, Outcome } from "../demo/types";
import { Corners, SlideFrame } from "../presentation/SlideFrame";
import type { DemoSpeed, PlugAction } from "../zwave/priority-route";
import "./real-network.css";

export interface RealRoutingSlideProps {
  title?: string;
  frames: readonly DemoFrame[];
  nodes: readonly DemoNode[];
  ready: boolean;
  busy: boolean;
  on: boolean | undefined;
  outcome: Outcome;
  cleanupRequired: boolean;
  canClearRoute: boolean;
  onAction(action: PlugAction, routed: boolean, speed: DemoSpeed): void;
  onClearRoute(): void;
  onClearCapture(): void;
}

export function RealRoutingSlide(props: RealRoutingSlideProps) {
  const [route, setRoute] = useState<"direct" | "routed">("direct");
  const [speed, setSpeed] = useState<DemoSpeed>("100k");
  const disabled = !props.ready || props.busy || props.cleanupRequired;
  return (
    <SlideFrame title={props.title ?? "Let's see it in action"}>
      <section className="zc figure-frame real-plug" aria-label="Plug, node 2" aria-busy={props.busy}>
        <Corners />
        <div className="zc-head">
          <span className="zc-id"><b>002</b> Plug</span>
        </div>
        <div className="real-plug-actions">
          <SegmentedControl label="Plug power" value={props.on === undefined ? "" : props.on ? "on" : "off"}
            options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]}
            disabled={disabled} onChange={value => props.onAction(value === "on" ? "on" : "off", route === "routed", speed)} />
          <Button disabled={disabled} onClick={() => props.onAction("ping", route === "routed", speed)}>PING</Button>
        </div>
        {props.outcome.kind !== "idle" && <OutcomeIndicator outcome={props.outcome} />}
        <label className="real-option-label">Communication</label>
        <SegmentedControl label="Communication route" value={route}
          options={[{ value: "direct", label: "Direct" }, { value: "routed", label: "Via 003" }]}
          disabled={props.busy} onChange={setRoute} />
        <label className="real-option-label">Requested speed</label>
        <SegmentedControl label="Requested data rate" value={speed}
          options={[{ value: "9.6k", label: "9.6k" }, { value: "40k", label: "40k" }, { value: "100k", label: "100k" }]}
          disabled={props.busy} onChange={setSpeed} />
        {props.cleanupRequired && <Button disabled={props.busy || !props.canClearRoute} onClick={props.onClearRoute}>Clear priority route</Button>}
      </section>
      <div className="real-lanes">
        <LaneView frames={props.frames} nodes={props.nodes} onClear={props.onClearCapture} fixedNodes />
      </div>
    </SlideFrame>
  );
}
