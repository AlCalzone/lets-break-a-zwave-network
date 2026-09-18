import type { DemoFrame, DemoNode, NodeAction, Outcome, Scenario } from "../types";

export const DEMO_NETWORK_ID = "demo";
export const MAX_DEMO_FRAMES = 64;
export const DEMO_ACTION_DELAY_MS = 650;

export const actionsByNode: Readonly<Record<string, readonly NodeAction[]>> = {
  "demo:1": ["basic-set", "ping"],
  "demo:2": ["on", "off"],
  "demo:3": ["report"],
  "demo:7": ["wake"],
};

export function createDemoNodes(): DemoNode[] {
  return [
    { id: "demo:1", networkId: DEMO_NETWORK_ID, nodeId: 1, label: "Controller", role: "Z-Wave JS", outcome: { kind: "success", label: "ACK", detail: "13.2 ms" } },
    { id: "demo:2", networkId: DEMO_NETWORK_ID, nodeId: 2, label: "Plug", role: "Repeater", on: false, outcome: { kind: "idle", label: "Off" } },
    { id: "demo:3", networkId: DEMO_NETWORK_ID, nodeId: 3, label: "Remote", role: "Destination", outcome: { kind: "idle", label: "Idle" } },
    { id: "demo:7", networkId: DEMO_NETWORK_ID, nodeId: 7, label: "Lock", role: "Battery", outcome: { kind: "idle", label: "Asleep" } },
  ];
}

export interface MockExchange {
  frames: DemoFrame[];
  outcome: Outcome;
  targetNodeId: number;
  confirmedOn?: boolean;
}

const commandPayloads: Record<NodeAction, readonly number[]> = {
  on: [0x25, 0x01, 0xff],
  off: [0x25, 0x01, 0x00],
  "basic-set": [0x20, 0x01, 0xff],
  ping: [0x00],
  report: [0x20, 0x03, 0xff],
  wake: [0x84, 0x07],
};

export function createMockExchange(
  node: DemoNode,
  action: NodeAction,
  scenario: Scenario,
  exchangeId: number,
  firstSequence: number,
): MockExchange {
  const reporting = action === "report" || action === "wake";
  const targetNodeId = node.nodeId === 1 ? (action === "on" || action === "off" ? 2 : 3) : node.nodeId;
  const route = targetNodeId === 2 ? [1, 2] : [1, 2, targetNodeId];
  if (reporting && node.nodeId !== 1) route.reverse();
  const routed = route.length > 2;
  const frames: DemoFrame[] = [];
  const attempts = scenario === "healthy" ? 1 : scenario === "retry" ? 2 : 3;
  const speedForHop = (source: number, target: number, attempt: number) =>
    source === 7 || target === 7 ? "9.6k" as const :
      attempt > 0 || source === 3 || target === 3 ? "40k" as const : "100k" as const;

  function addFrame(
    source: number,
    target: number,
    kind: DemoFrame["kind"],
    timestampMs: number,
    attempt: number,
    retry = attempt > 0 && kind.endsWith("DATA"),
    payload = commandPayloads[action],
  ) {
    const sequence = firstSequence + frames.length;
    frames.push({
      id: `${node.networkId}:${exchangeId}:${sequence}`,
      networkId: node.networkId,
      exchangeId,
      sequence,
      timestampMs: Math.round(timestampMs * 10) / 10,
      source,
      target,
      route: [...route],
      kind,
      payload: Uint8Array.from(kind.endsWith("DATA") ? payload : []),
      speed: speedForHop(source, target, attempt),
      rssi: source === 1 || target === 1 ? -52 - attempt * 3 : -61 - attempt * 3,
      channel: attempt > 0 ? 1 : 0,
      retry,
    });
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    const start = attempt * 48;
    for (let hop = 0; hop < route.length - 1; hop++) {
      addFrame(route[hop], route[hop + 1], routed ? "ROUTED DATA" : "DATA", start + hop * 4.1, attempt);
    }
    if (attempt === attempts - 1 && scenario !== "no-ack") {
      for (let hop = route.length - 1; hop > 0; hop--) {
        addFrame(route[hop], route[hop - 1], routed ? "ROUTED ACK" : "ACK", start + 9.8 + (route.length - 1 - hop) * 3.4, attempt);
      }
    }
  }

  if (scenario === "no-ack") {
    if (routed) addFrame(route[1], route[0], "ROUTED ERROR", 144, attempts - 1);
    return { frames, targetNodeId, outcome: { kind: "error", label: "No ACK", detail: "after 3 tries" } };
  }

  const confirmedOn = action === "on" ? true : action === "off" ? false :
    action === "basic-set" && targetNodeId === 2 ? true : undefined;
  if (confirmedOn !== undefined) {
    const reportStart = frames[frames.length - 1].timestampMs + 8;
    for (let hop = route.length - 1; hop > 0; hop--) {
      addFrame(route[hop], route[hop - 1], routed ? "ROUTED DATA" : "DATA", reportStart + (route.length - 1 - hop) * 4.1, attempts - 1, false, [0x25, 0x03, confirmedOn ? 0xff : 0x00]);
    }
    for (let hop = 0; hop < route.length - 1; hop++) {
      addFrame(route[hop], route[hop + 1], routed ? "ROUTED ACK" : "ACK", reportStart + 9.8 + hop * 3.4, attempts - 1);
    }
  }
  const duration = frames[frames.length - 1].timestampMs;
  const label = action === "wake" ? "Awake" : action === "report" ? "Report received" :
    confirmedOn !== undefined ? (confirmedOn ? "On" : "Off") : "ACK";
  const detail = `${duration.toFixed(1)} ms${scenario === "retry" ? " · retry 1 / 3" : ""}`;
  return { frames, targetNodeId, confirmedOn, outcome: { kind: "success", label, detail } };
}

export function createBaselineFrames(): DemoFrame[] {
  return createMockExchange(createDemoNodes()[0], "basic-set", "healthy", 1, 1).frames;
}

export function appendDemoFrames(previous: readonly DemoFrame[], added: readonly DemoFrame[]): DemoFrame[] {
  return [...previous, ...added].slice(-MAX_DEMO_FRAMES);
}

export function settleMockAction(nodes: readonly DemoNode[], actor: DemoNode, exchange: MockExchange): DemoNode[] {
  return nodes.map((node) => {
    if (node.networkId !== actor.networkId) return node;
    const isActor = node.id === actor.id;
    const isSwitch = node.nodeId === exchange.targetNodeId && exchange.confirmedOn !== undefined;
    if (!isActor && !isSwitch) return node;
    return {
      ...node,
      ...(isSwitch ? { on: exchange.confirmedOn } : {}),
      outcome: { ...exchange.outcome },
    };
  });
}
