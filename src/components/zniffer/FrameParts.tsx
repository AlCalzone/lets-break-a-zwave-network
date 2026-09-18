import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { DemoFrame, FrameSpeed } from "../../demo/types";
import { fitPayload, frameLabel, isAck, isError, speedClass } from "./frameData";

type ChipFrame = Pick<DemoFrame, "kind" | "payload" | "retry">;

function PayloadChip({ frame }: { frame: ChipFrame }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [space, setSpace] = useState({ width: 120, fontSize: 21 });
  useLayoutEffect(() => {
    const element = ref.current;
    const cell = element?.parentElement;
    if (!element || !cell) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const width = cell.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
      if (width <= 0) return;
      const fontSize = parseFloat(style.getPropertyValue("--zn-payload-font-size")) || 21;
      setSpace((previous) => previous.width === width && previous.fontSize === fontSize
        ? previous : { width, fontSize });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(cell);
    return () => observer.disconnect();
  }, []);
  const hex = frameLabel(frame);
  const fitted = fitPayload(hex, space.width, space.fontSize);
  const label = `${hex}${frame.retry ? " · retry" : ""}`;
  return (
    <span className="zn-type zn-payload-chip" ref={ref} role="img" aria-label={label} title={label}>
      <span className="zn-payload" style={{ fontSize: fitted.fontSize }} aria-hidden="true">{fitted.text}</span>
      {frame.retry && <span className="zn-retry" aria-hidden="true"> · retry</span>}
    </span>
  );
}

export function FrameChip({ frame }: { frame: ChipFrame }) {
  if (frame.kind.endsWith("DATA")) return <PayloadChip frame={frame} />;
  return (
    <span className={`zn-type${isAck(frame) ? " is-ack" : ""}${isError(frame) ? " is-err" : ""}`}>
      {frameLabel(frame)}{frame.retry && <span className="zn-retry"> · retry</span>}
    </span>
  );
}

export function SpeedBadge({ speed }: { speed?: FrameSpeed }) {
  return <span className={`sp${speed ? ` sp-${speedClass(speed)}` : ""}`}>{speed ?? "—"}</span>;
}

export function RSSIIndicator({ rssi }: { rssi?: number }) {
  if (rssi === undefined || !Number.isFinite(rssi)) {
    return <span className="rssi" aria-label="RSSI unavailable">—</span>;
  }
  const strength = rssi >= -50 ? 4 : rssi >= -60 ? 3 : rssi >= -70 ? 2 : 1;
  return (
    <span className="rssi" aria-label={`RSSI ${rssi} dBm`} title={`${rssi} dBm`}>
      <b aria-hidden="true">
        {[0, 1, 2, 3].map((bar) => (
          <i key={bar} className={bar < strength ? "on" : ""} style={{ height: `${40 + bar * 20}%` }} />
        ))}
      </b>
      <span>{String(rssi).replace("-", "−")}</span>
    </span>
  );
}

export function NodePath({ frame, path = frame.route }: {
  frame: Pick<DemoFrame, "source" | "target" | "route">;
  path?: readonly number[];
}) {
  const nodes = [...new Set([...path, frame.source, frame.target])];
  const sourceIndex = nodes.indexOf(frame.source);
  const targetIndex = nodes.indexOf(frame.target);
  const reverse = sourceIndex > targetIndex;
  return (
    <span className="zn-chain" role="img" aria-label={`Node ${frame.source} to node ${frame.target}; path ${nodes.join(", ")}`}>
      {nodes.map((node, index) => {
        const active = index >= Math.min(sourceIndex, targetIndex) && index < Math.max(sourceIndex, targetIndex);
        return (
          <Fragment key={node}>
            <span className={`zn-nd ${node === frame.source ? "tx" : node === frame.target ? "rx" : "idle"}`} aria-hidden="true">
              {node}
            </span>
            {index < nodes.length - 1 && (
              <span className={`zn-hop${active ? "" : " dim"}`} aria-hidden="true">{reverse ? "←" : "→"}</span>
            )}
          </Fragment>
        );
      })}
    </span>
  );
}
