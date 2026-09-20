import { useEffect, useRef, useSyncExternalStore } from "react";
import type { DemoFrame, DemoNode } from "../demo/types";
import { Button, OutcomeIndicator, SegmentedControl } from "../components/controls";
import { LaneView } from "../components/zniffer";
import { Corners, SlideFrame } from "../presentation/SlideFrame";
import { FAKE_REPEATER_NODE_ID, SECOND_FAKE_REPEATER_NODE_ID } from "../zwave/network";
import { returnRouteRelay, type RelayMode } from "../zwave/return-route-relay";
import "./return-route-relay.css";

export interface ReturnRouteRelaySlideProps {
  frames: readonly DemoFrame[];
  nodes: readonly DemoNode[];
  ready: boolean;
  onClearCapture(): void;
}

export function ReturnRouteRelaySlide({ frames, nodes, ready, onClearCapture }: ReturnRouteRelaySlideProps) {
  const relay = useSyncExternalStore(returnRouteRelay.subscribe, returnRouteRelay.getSnapshot, returnRouteRelay.getSnapshot);
  const root = useRef<HTMLElement>(null);
  const disabled = !ready || relay.busy;
  const networkId = nodes[0]?.networkId ?? "main";
  const laneNodes = [
    nodes.find(node => node.nodeId === 1),
    {
      id: `${networkId}:${FAKE_REPEATER_NODE_ID}`,
      networkId,
      nodeId: FAKE_REPEATER_NODE_ID,
      label: "RCP-1",
      role: "Fake repeater",
      outcome: { kind: "idle" as const, label: "Raw relay" },
    },
    {
      id: `${networkId}:${SECOND_FAKE_REPEATER_NODE_ID}`,
      networkId,
      nodeId: SECOND_FAKE_REPEATER_NODE_ID,
      label: "RCP-2",
      role: "Drop relay",
      outcome: { kind: "idle" as const, label: "Raw relay" },
    },
    nodes.find(node => node.nodeId === 3),
  ].filter((node): node is DemoNode => node !== undefined);

  useEffect(() => {
    const slot = root.current?.closest(".slide-slot");
    if (!slot) return;
    const observer = new MutationObserver(() => {
      if (!slot.hasAttribute("data-deck-active")) void returnRouteRelay.teardown();
    });
    observer.observe(slot, { attributes: true, attributeFilter: ["data-deck-active"] });
    return () => {
      observer.disconnect();
      void returnRouteRelay.teardown();
    };
  }, []);

  function setup() {
    onClearCapture();
    void returnRouteRelay.setup();
  }

  return (
    <SlideFrame title="Who's in the middle?">
      <section ref={root} className="return-route-controls figure-frame" data-deck-interactive aria-busy={relay.busy}>
        <Corners />
        <div className="return-route-section">
          <h3>Route injection · node 003</h3>
          <p>The priority SUC return route is 003 → 005 → 004 → 001.</p>
          <div className="return-route-actions">
            <Button primary disabled={disabled || relay.active} onClick={setup}>Setup</Button>
            <Button disabled={disabled || !relay.active} onClick={() => void returnRouteRelay.teardown()}>Teardown</Button>
          </div>
          <SegmentedControl<RelayMode> label="Relay mode" value={relay.mode}
            options={[{ value: "forward", label: "Forward" }, { value: "drop", label: "Drop" }]}
            disabled={disabled || !relay.active} onChange={mode => returnRouteRelay.setMode(mode)} />
          <OutcomeIndicator compact outcome={relay.outcome} />
        </div>
      </section>

      <div className="return-route-lanes">
        <LaneView frames={frames} nodes={laneNodes} onClear={onClearCapture} fixedNodes
          emptyMessage="Set up the route to relay dimmer reports." />
      </div>
    </SlideFrame>
  );
}
