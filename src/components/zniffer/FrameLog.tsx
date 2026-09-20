import type { DemoFrame } from "../../demo/types";
import { FrameChip, NodePath, RSSIIndicator, SpeedBadge } from "./FrameParts";
import { formatTime, isAck, prepareFrames } from "./frameData";
import { useFrameScroll } from "./useFrameScroll";

export interface FrameLogProps {
  frames: readonly DemoFrame[];
  onClear: () => void;
  variant?: "full" | "compact" | "hops";
  title?: string;
  showFrameCount?: boolean;
}

export function FrameLog({ frames, onClear, variant = "full", title, showFrameCount = true }: FrameLogProps) {
  const rows = prepareFrames(frames);
  const bodyRef = useFrameScroll(rows.at(-1)?.frame.id, variant);
  const heading = title ?? (variant === "hops" ? "Hop list" : variant === "compact" ? "Frame log · compact" : "Frame log");
  const columns = ["#", ...(variant === "full" ? ["Time · ms"] : []), "Path · direction", "Frame", "Speed", ...(variant === "full" ? ["RSSI", "Ch"] : [])];
  return (
    <section className={`zn zn-live figure-frame zn-live-${variant}`} aria-label={heading}>
      <div className="zn-bar">
        <span>{heading}</span>
        <div className="zn-actions">
          {showFrameCount && <span className="meta">{frames.length} frames</span>}
          <button type="button" className="zn-clear" onClick={onClear}>Clear</button>
        </div>
      </div>
      <div className="zn-log" role="table" aria-label={heading}>
        <div className="zn-hd zn-live-cols" role="row">
          {columns.map((column) => <span role="columnheader" key={column}>{column}</span>)}
        </div>
        <div className="zn-live-rows" role="rowgroup" ref={bodyRef} tabIndex={0} data-own-arrow-keys aria-label="Captured frames">
          {rows.map(({ frame, elapsedMs, path }) => (
            <div key={frame.id} data-frame-id={frame.id} className={`zn-r zn-live-cols${isAck(frame) ? " is-ack" : ""}`} role="row">
              <span role="cell" className="zn-seq">{String(frame.sequence).padStart(2, "0")}</span>
              {variant === "full" && <span role="cell" className="zn-t">{formatTime(elapsedMs)}</span>}
              <span role="cell" className="zn-path-cell"><NodePath frame={frame} path={variant === "compact" ? frame.route : path} /></span>
              <span role="cell" className="zn-frame-cell"><FrameChip frame={frame} compact={variant === "compact"} /></span>
              <span role="cell" className="zn-speed-cell"><SpeedBadge speed={frame.speed} /></span>
              {variant === "full" && <>
                <span role="cell" className="zn-rssi-cell"><RSSIIndicator rssi={frame.rssi} /></span>
                <span role="cell" className="zn-ch">{frame.channel ?? "—"}</span>
              </>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
