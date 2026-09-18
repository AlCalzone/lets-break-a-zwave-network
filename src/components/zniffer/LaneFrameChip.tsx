import { useLayoutEffect, useRef, useState } from "react";
import type { DemoFrame } from "../../demo/types";
import { fitPayload, frameLabel, isError, speedClass } from "./frameData";

export function LaneFrameChip({ frame, center, y }: { frame: DemoFrame; center: number; y: number }) {
  const payload = frame.kind.endsWith("DATA");
  const label = frameLabel(frame);
  const suffix = frame.retry ? " · retry" : "";
  const fitted = payload ? fitPayload(label, 220, 23, suffix) : undefined;
  const text = fitted?.text ?? label + suffix;
  const baseSize = fitted?.fontSize ?? 23;
  const textRef = useRef<SVGTextElement>(null);
  const key = `${payload}:${baseSize}:${text}`;
  const [measured, setMeasured] = useState({ key: "", width: 0 });
  const naturalWidth = measured.key === key ? measured.width : text.length * baseSize * (payload ? 0.62 : 0.5);
  const fontSize = payload ? baseSize : Math.min(baseSize, baseSize * 220 / Math.max(1, naturalWidth));
  const width = naturalWidth * fontSize / baseSize + (payload ? 20 : 30);

  useLayoutEffect(() => {
    let active = true;
    const measure = () => {
      if (!active || !textRef.current) return;
      const width = textRef.current.getComputedTextLength() * baseSize / fontSize;
      if (width <= 0) return;
      setMeasured(previous => previous.key === key && Math.abs(previous.width - width) < 0.1
        ? previous : { key, width });
    };
    measure();
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      active = false;
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [key, baseSize, fontSize]);

  return <>
    <rect className={`chip ${payload ? `f-${speedClass(frame.speed)}` : "k"}${isError(frame) ? " zn-lane-error" : ""}`}
      x={center - width / 2} y={y - 18} width={width} height="36" />
    {!payload && <rect className={`sw-${speedClass(frame.speed)}`} x={center - width / 2 + 3} y={y - 15} width="12" height="30" />}
    <text ref={textRef}
      className={`cl${isError(frame) ? " zn-lane-error-label" : ""}${payload ? " zn-payload" : ""}${payload && (frame.speed === "100k" || frame.speed === "LR") ? " on" : ""}`}
      style={{ fontSize }} aria-hidden="true" x={center + (payload ? 0 : 5)} y={y + fontSize * 0.35}>
      {text}
    </text>
  </>;
}
