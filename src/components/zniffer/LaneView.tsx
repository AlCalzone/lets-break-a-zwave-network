import { useId, useLayoutEffect, useRef, useState } from "react";
import type { DemoFrame, DemoNode, FrameSpeed } from "../../demo/types";
import { explorerRepeaters, formatTime, frameLabel, isAck, isError, prepareFrames, speedClass } from "./frameData";
import { LaneFrameChip } from "./LaneFrameChip";
import { useFrameScroll } from "./useFrameScroll";

const legendSpeeds: readonly FrameSpeed[] = ["9.6k", "40k", "100k", "LR"];

export function laneCanvasHeight(frameCount: number, width: number, viewport: { width: number; height: number }) {
  return Math.max(240, 16 + frameCount * 56, Math.floor(viewport.height * width / Math.max(width, viewport.width)));
}

export interface LaneViewProps {
  frames: readonly DemoFrame[];
  nodes: readonly DemoNode[];
  onClear: () => void;
  fixedNodes?: boolean;
  emptyMessage?: string;
}

export function LaneView({ frames, nodes, onClear, fixedNodes = false, emptyMessage = "" }: LaneViewProps) {
  const id = useId().replace(/:/g, "");
  const rows = prepareFrames(fixedNodes ? frames.filter(frame =>
    nodes.some(node => node.networkId === frame.networkId && node.nodeId === frame.source)
    && (frame.broadcast || nodes.some(node => node.networkId === frame.networkId && node.nodeId === frame.target)),
  ) : frames);
  const latest = rows.at(-1)?.frame;
  const bodyRef = useFrameScroll(latest?.id);
  const headerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const lanes: { networkId: string; nodeId: number; label?: string }[] = fixedNodes
    ? nodes.map(({ networkId, nodeId, label }) => ({ networkId, nodeId, label }))
    : [];
  if (!fixedNodes) {
    for (const { frame, path } of rows) {
      for (const nodeId of path) {
        if (!lanes.some((lane) => lane.networkId === frame.networkId && lane.nodeId === nodeId)) {
          const node = nodes.find((item) => item.networkId === frame.networkId && item.nodeId === nodeId);
          lanes.push({ networkId: frame.networkId, nodeId, label: node?.label });
        }
      }
    }
  }
  const hasLanes = !!(latest || lanes.length);
  useLayoutEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [bodyRef, hasLanes]);
  const baseWidth = Math.max(1020, 340 + (lanes.length - 1) * 340);
  const laneSpacing = lanes.length > 1 ? (baseWidth - 340) / (lanes.length - 1) : 340;
  const x = (index: number) => 180 + index * laneSpacing;
  const laneX = (frame: DemoFrame, nodeId: number) => x(lanes.findIndex((lane) => lane.networkId === frame.networkId && lane.nodeId === nodeId));
  const width = Math.max(baseWidth, ...rows.filter(({ frame }) => frame.broadcast)
    .map(({ frame }) => laneX(frame, frame.source) + laneSpacing * 0.8 + 40));
  const height = laneCanvasHeight(rows.length, width, viewport);
  return (
    <section className="zn zn-live zn-live-lanes figure-frame" aria-label="Zniffer">
      <div className="zn-bar">
        <span>Zniffer</span>
        <div className="zn-actions">
          <div className="zn-speed-legend" role="list" aria-label="Frame speed legend">
            {legendSpeeds.map(speed => (
              <span key={speed} role="listitem">
                <svg className="zl" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <rect className={`sw-${speedClass(speed)}`} x="1" y="1" width="12" height="12" />
                </svg>
                {speed === "LR" ? "LR" : `${speed.slice(0, -1)} kbps`}
              </span>
            ))}
          </div>
          <button type="button" className="zn-clear" onClick={onClear}>Clear</button>
        </div>
      </div>
      {hasLanes ? (
        <>
        <div className="zn-lane-header" ref={headerRef}>
          <svg className="zl" viewBox={`0 0 ${width} 48`} style={{ minWidth: width }} role="img" aria-label="Lane node headers">
            <text className="hdr" x="60" y="32" textAnchor="end">MS</text>
            {lanes.map((lane, index) => (
              <text key={`${lane.networkId}:${lane.nodeId}`} className="lane" x={x(index)} y="32">
                {`${String(lane.nodeId).padStart(3, "0")} · ${(lane.label ?? "—").toUpperCase()}`}
              </text>
            ))}
          </svg>
        </div>
        <div className="zn-fig" ref={bodyRef} tabIndex={0} data-own-arrow-keys role="region" aria-label="Captured frame lanes" onScroll={(event) => {
          if (headerRef.current) headerRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}>
          {!latest && emptyMessage && <div className="zn-capture-waiting" role="status">{emptyMessage}</div>}
          <svg className="zl" viewBox={`0 0 ${width} ${height}`} style={{ minWidth: width }} role="group" aria-labelledby={`${id}-title`}>
            <title id={`${id}-title`}>{`${rows.length} captured frames. Time in milliseconds from the start of each exchange.`}</title>
            <defs>
              {["normal", "error"].map((kind) => (
                <marker key={kind} id={`${id}-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto">
                  <path d="M0 0L10 5L0 10Z" fill={kind === "error" ? "#a83a29" : "var(--color-accent-900)"} />
                </marker>
              ))}
              <marker id={`${id}-broadcast`} viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto">
                <path d="M2 4Q5 6 2 8M5 1Q11 6 5 11" fill="none" stroke="var(--color-accent-900)" strokeWidth="1.5" strokeLinecap="round" />
              </marker>
            </defs>
            {lanes.map((lane, index) => (
              <path key={`${lane.networkId}:${lane.nodeId}`} className="life" d={`M${x(index)} 0V${height - 4}`} />
            ))}
            {rows.map(({ frame, elapsedMs }, index) => {
              const y = 36 + index * 56;
              const from = laneX(frame, frame.source);
              const to = frame.broadcast
                ? from + laneSpacing * 0.8
                : laneX(frame, frame.target);
              const direction = to > from ? 1 : -1;
              const center = (from + to) / 2;
              const ack = isAck(frame);
              const error = isError(frame);
              const hex = frameLabel(frame);
              const suffix = frame.retry ? " · retry" : "";
              const fullLabel = hex + suffix;
              const repeaters = explorerRepeaters(frame);
              const destination = frame.broadcast ? `broadcasts, searching for node ${frame.target}` : `to node ${frame.target}`;
              const description = `#${frame.sequence}: node ${frame.source} ${destination}, ${fullLabel}${repeaters ? `, ${repeaters.description}` : ""}, ${frame.speed}, ${formatTime(elapsedMs)} ms`;
              return (
                <g key={frame.id} data-frame-id={frame.id} role="img" aria-label={description}>
                  <title>{description}</title>
                  {index % 2 === 0 && <rect className="band" x="0" y={y - 28} width={width} height="56" />}
                  <text className="tm" x="100" y={y + 8} textAnchor="end">{formatTime(elapsedMs)}</text>
                  {frame.broadcast ? (
                    <path className="arw zn-broadcast" d={`M${from} ${y}H${to}`} markerEnd={`url(#${id}-broadcast)`} />
                  ) : <path className={`arw${ack ? " ack" : ""}${error ? " err" : ""}`} d={`M${from + direction * 8} ${y}H${to - direction * 18}`} markerEnd={`url(#${id}-${error ? "error" : "normal"})`} />}
                  <LaneFrameChip frame={frame} center={center} y={y} />
                </g>
              );
            })}
          </svg>
        </div>
        </>
      ) : emptyMessage ? <div className="zn-empty" role="status">{emptyMessage}</div> : null}
    </section>
  );
}
