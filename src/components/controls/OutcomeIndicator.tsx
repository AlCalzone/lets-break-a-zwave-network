import type { Outcome } from "../../demo/types";
import "./controls.css";

export interface OutcomeIndicatorProps {
  outcome: Outcome;
  compact?: boolean;
  className?: string;
}

export function OutcomeIndicator({
  outcome,
  compact = false,
  className = "",
}: OutcomeIndicatorProps) {
  const statusClass =
    outcome.kind === "success" ? "ok" : outcome.kind === "error" ? "bad" : "wait";

  return (
    <div
      className={`zc-out demo-outcome ${statusClass} ${className}`}
      data-outcome={outcome.kind}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      title={compact ? outcome.detail : undefined}
    >
      <i aria-hidden="true" />
      <span>{outcome.label}</span>
      {!compact && outcome.detail && <em>{outcome.detail}</em>}
    </div>
  );
}
