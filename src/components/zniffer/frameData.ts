import type { DemoFrame } from "../../demo/types";

export const exchangeKey = (frame: DemoFrame) =>
  JSON.stringify([frame.networkId, frame.exchangeId]);

export function prepareFrames(frames: readonly DemoFrame[]) {
  const ordered = [...frames].sort((a, b) => a.sequence - b.sequence);
  const paths = new Map<string, number[]>();
  for (const frame of ordered) {
    if (frame.broadcast) continue;
    const key = exchangeKey(frame);
    const path = paths.get(key) ?? [];
    for (const node of [...frame.route, frame.source, frame.target]) {
      if (!path.includes(node)) path.push(node);
    }
    paths.set(key, path);
  }
  return ordered.map((frame) => ({
    frame,
    elapsedMs: frame.timestampMs,
    path: frame.broadcast || frame.kind === "SEARCH RESULT" ? frame.route : paths.get(exchangeKey(frame))!,
  }));
}

export function speedClass(speed?: DemoFrame["speed"]) {
  return { "9.6k": "9", "40k": "40", "100k": "100", LR: "lr" }[speed ?? "100k"];
}

export const isAck = (frame: Pick<DemoFrame, "kind">) => frame.kind.endsWith("ACK");
export const isError = (frame: Pick<DemoFrame, "kind">) => frame.kind.endsWith("ERROR");

export function frameLabel(
  frame: Pick<DemoFrame, "kind" | "payload" | "explorer">,
  abbreviateRoutedResponses = false,
) {
  if (frame.kind === "EXPLORE" || frame.kind === "SEARCH RESULT") {
    const list = explorerRepeaters(frame)?.text ?? "?";
    return `${frame.kind === "EXPLORE" ? "Explore" : "Result"} ${list ? `[ ${list} ]` : "[ ]"}`;
  }
  return frame.kind.endsWith("DATA")
    ? Array.from(frame.payload, (byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ") || "—"
    : abbreviateRoutedResponses
      ? frame.kind === "ROUTED ACK" ? "R-ACK" : frame.kind === "ROUTED ERROR" ? "R-ERR" : frame.kind
      : frame.kind;
}

export function explorerRepeaters(frame: Pick<DemoFrame, "kind" | "explorer">) {
  const repeaters = frame.kind === "SEARCH RESULT" ? frame.explorer?.resultRepeaters : frame.explorer?.repeaters;
  if (!repeaters) return undefined;
  const nodes = repeaters.map(String);
  return {
    text: nodes.join(", "),
    description: `${frame.kind === "SEARCH RESULT" ? "Final" : "Recorded"} repeaters: ${nodes.length ? nodes.join(", ") : "none"}`,
  };
}

export const MIN_PAYLOAD_FONT_SIZE = 18;
export const PAYLOAD_CHARACTER_WIDTH = 0.62;

export function fitPayload(
  hex: string,
  width: number,
  maximumFontSize: number,
  suffix = "",
) {
  const fullText = hex + suffix;
  const fittingSize = width / (Math.max(1, fullText.length) * PAYLOAD_CHARACTER_WIDTH);
  if (fittingSize >= MIN_PAYLOAD_FONT_SIZE) {
    return { text: fullText, fontSize: Math.floor(Math.min(maximumFontSize, fittingSize) * 10) / 10, truncated: false };
  }
  const characterBudget = Math.floor(width / (MIN_PAYLOAD_FONT_SIZE * PAYLOAD_CHARACTER_WIDTH));
  const byteCount = Math.max(0, Math.floor((characterBudget - suffix.length - 3) / 3));
  const prefix = byteCount ? `${hex.slice(0, byteCount * 3 - 1)} ` : "";
  return { text: `${prefix}...${suffix}`, fontSize: MIN_PAYLOAD_FONT_SIZE, truncated: true };
}

export function formatTime(value: number) {
  return Number.isFinite(value) ? value.toFixed(0) : "—";
}
