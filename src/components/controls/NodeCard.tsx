import type { DemoNode, NodeAction } from "../../demo/types";
import { Button } from "./Button";
import { OutcomeIndicator } from "./OutcomeIndicator";
import "./controls.css";

export interface NodeCardProps {
  node: DemoNode;
  actions: readonly NodeAction[];
  compact?: boolean;
  onAction: (action: NodeAction) => void;
  disabled?: boolean;
  className?: string;
}

const actionLabels: Record<NodeAction, string> = {
  on: "On",
  off: "Off",
  "basic-set": "Basic Set",
  ping: "Ping",
  report: "Report",
  wake: "Wake",
};

export function NodeCard({
  node,
  actions,
  compact = false,
  onAction,
  disabled = false,
  className = "",
}: NodeCardProps) {
  return (
    <section
      className={`zc figure-frame demo-node${compact ? " is-compact" : ""} ${className}`}
      aria-label={`Mock ${node.label}, node ${node.nodeId}, network ${node.networkId}`}
      aria-busy={node.outcome.kind === "pending"}
      data-node-key={node.id}
    >
      {["tl", "tr", "bl", "br"].map((corner) => (
        <i key={corner} className={`corner ${corner}`} aria-hidden="true" />
      ))}
      <div className="zc-head">
        <span className="zc-id"><b>{node.nodeId}</b> {node.label}</span>
        {!compact && <span className="zc-role">{node.role}</span>}
      </div>
      <div className="zc-acts">
        {actions.map((action) => {
          const selected = action === "on" ? node.on === true : action === "off" ? node.on === false : undefined;
          return (
            <Button
              key={action}
              primary={selected ?? action === "basic-set"}
              wide={compact && actions.length === 1}
              disabled={disabled || node.outcome.kind === "pending"}
              aria-pressed={selected}
              onClick={() => onAction(action)}
            >
              {actionLabels[action]}
            </Button>
          );
        })}
      </div>
      <OutcomeIndicator outcome={node.outcome} compact={compact} />
    </section>
  );
}
