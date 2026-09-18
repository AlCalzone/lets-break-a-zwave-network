import { useState, type ReactNode } from "react";
import { NodeCard, SegmentedControl } from "../components/controls";
import { FrameLog, LaneView } from "../components/zniffer";
import { actionsByNode } from "../demo/fixtures";
import { useDemo } from "../demo/store";
import type { DemoNode, Scenario } from "../demo/types";
import { Corners, SlideFrame } from "../presentation/SlideFrame";
import "../styles/demo.css";

const scenarios: { value: Scenario; label: string }[] = [
  { value: "healthy", label: "Healthy" },
  { value: "retry", label: "Retry" },
  { value: "no-ack", label: "No ACK" },
];

function Controls({ node, compact = false }: { node: DemoNode; compact?: boolean }) {
  const { performAction, pending } = useDemo();
  return (
    <NodeCard
      node={node}
      compact={compact}
      actions={actionsByNode[node.id]}
      onAction={(action) => performAction(node.id, action)}
      disabled={pending}
    />
  );
}

function MockLabel() {
  const { reset } = useDemo();
  return (
    <div className="demo-topline">
      <span className="demo-tag">Simulated nodes &amp; frames</span>
      <button className="demo-reset" onClick={reset}>Reset demo</button>
    </div>
  );
}

function ScenarioPicker() {
  const { scenario, setScenario, pending } = useDemo();
  return (
    <div className="demo-scenario">
      <span className="demo-scenario-label">Delivery scenario</span>
      <SegmentedControl label="Delivery scenario" options={scenarios} value={scenario} onChange={setScenario} disabled={pending} />
    </div>
  );
}

function CompactScenario() {
  const { scenario, setScenario, pending } = useDemo();
  return (
    <div className="zc figure-frame demo-condition">
      <Corners />
      <div className="zc-head"><span className="zc-id">Delivery scenario</span></div>
      <select aria-label="Delivery scenario" value={scenario} disabled={pending} onChange={(event) => {
        const selected = scenarios.find((option) => option.value === event.target.value);
        if (selected) setScenario(selected.value);
      }}>
        {scenarios.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <span className="zc-out">Simulated · no RF changes</span>
    </div>
  );
}

export function LaneDemo() {
  const { nodes, frames, clearCapture } = useDemo();
  return (
    <SlideFrame title="Follow the conversation">
      <MockLabel />
      <div className="demo-cards">
        {nodes.slice(0, 3).map((node) => <Controls key={node.id} node={node} />)}
      </div>
      <div className="demo-lanes"><LaneView frames={frames} nodes={nodes} onClear={clearCapture} /></div>
      <aside className="demo-guide">
        <h3>One arrow per hop</h3>
        <p>Send a command. Follow the data to its destination and the acknowledgment back.</p>
        <p>Chip color shows the data rate. Data chips show hexadecimal payloads. Scroll back through captured frames.</p>
        <ScenarioPicker />
      </aside>
    </SlideFrame>
  );
}

export function FrameDemo() {
  const { nodes, frames, clearCapture } = useDemo();
  const [variant, setVariant] = useState<"full" | "compact" | "hops">("full");
  return (
    <SlideFrame title="Every frame tells a story">
      <MockLabel />
      <div className="demo-log-modes">
        <SegmentedControl
          label="Frame view"
          value={variant}
          onChange={setVariant}
          options={[
            { value: "full", label: "Full log" },
            { value: "compact", label: "Compact" },
            { value: "hops", label: "Hop list" },
          ]}
        />
      </div>
      <div className="demo-sidebar">
        {nodes.slice(0, 2).map((node) => <Controls key={node.id} node={node} />)}
        <ScenarioPicker />
      </div>
      <div className="demo-log"><FrameLog frames={frames} variant={variant} onClear={clearCapture} /></div>
    </SlideFrame>
  );
}

export function WaterfallDemo({ terminal }: { terminal: ReactNode }) {
  const { nodes, frames, clearCapture } = useDemo();
  return (
    <SlideFrame title="See the network on air">
      <MockLabel />
      <div className="demo-cards compact">
        {nodes.map((node) => <Controls key={node.id} node={node} compact />)}
        <CompactScenario />
      </div>
      <div className="demo-panel-label capture">Frame log · simulated</div>
      <div className="demo-panel-label waterfall">sdrtop · local tinySA</div>
      <div className="demo-capture"><FrameLog frames={frames} variant="compact" onClear={clearCapture} /></div>
      <div className="demo-waterfall">{terminal}</div>
      <p className="demo-bottom-note">The receiver observes real RF activity. Mock node controls do not transmit radio frames.</p>
    </SlideFrame>
  );
}
