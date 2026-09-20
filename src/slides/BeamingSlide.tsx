import { useState } from "react";
import { ReceiverPanel } from "./ReceiverPanel";
import { SlideFrame } from "../presentation/SlideFrame";
import { beaming, useBeaming, type BeamKind } from "../zwave/beaming";
import { hardware, primaryRcpId } from "../zwave/hardware";
import "../styles/beaming.css";

const presets: {
  kind: Exclude<BeamKind, "continuous">;
  label: string;
  detail: string;
  disabled?: boolean;
}[] = [
  { kind: "short", label: "Short beam", detail: "275 ms" },
  { kind: "long", label: "Long beam", detail: "1100 ms" },
  { kind: "fragmented", label: "Fragmented beam", detail: "16 × 112 ms", disabled: true },
];

export function BeamingSlide() {
  const state = useBeaming();
  const [actionError, setActionError] = useState("");
  const ready = !!hardware.getRcpHost(primaryRcpId);

  function attempt(operation: Promise<void>) {
    setActionError("");
    void operation.catch(error => setActionError(error instanceof Error ? error.message : String(error)));
  }

  return (
    <SlideFrame title="So anyway, I started blasting">
      <div className="beam-controls" data-deck-interactive>
        <div className="beam-continuous">
          <button type="button" className="beam-primary" disabled={!ready || state.active}
            onClick={() => attempt(beaming.start("continuous"))}>Start beaming</button>
          <button type="button" disabled={!ready || !state.active}
            onClick={() => attempt(beaming.stop())}>Stop beaming</button>
        </div>

        <div className="beam-presets">
          {presets.map(preset => (
            <button type="button" key={preset.kind} disabled={preset.disabled || !ready || state.active}
              onClick={() => attempt(beaming.start(preset.kind))}>
              <strong>{preset.label}</strong>
              <span>{preset.detail}</span>
            </button>
          ))}
        </div>

        {(actionError || state.error || (ready && state.notice)) && <p
          className={`beam-status ${actionError || state.error ? "is-error" : ""}`}
          role={actionError || state.error ? "alert" : "status"}>
          {actionError || state.error || state.notice}
        </p>}
      </div>

      <div className="beam-waterfall-label">Live RF waterfall</div>
      <div className="beam-waterfall"><ReceiverPanel /></div>
    </SlideFrame>
  );
}
