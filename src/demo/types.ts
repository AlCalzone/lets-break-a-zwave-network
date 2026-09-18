export type Scenario = "healthy" | "retry" | "no-ack";
export type OutcomeKind = "idle" | "pending" | "success" | "error";

export interface Outcome {
  kind: OutcomeKind;
  label: string;
  detail?: string;
}

export interface DemoNode {
  id: string;
  networkId: string;
  nodeId: number;
  label: string;
  role: string;
  on?: boolean;
  outcome: Outcome;
}

export type NodeAction = "on" | "off" | "basic-set" | "ping" | "report" | "wake";
export type FrameSpeed = "9.6k" | "40k" | "100k" | "LR";
export type FrameKind = "DATA" | "ACK" | "ROUTED DATA" | "ROUTED ACK" | "ROUTED ERROR";

export interface DemoFrame {
  id: string;
  networkId: string;
  exchangeId: number;
  sequence: number;
  timestampMs: number;
  source: number;
  target: number;
  route: number[];
  kind: FrameKind;
  payload: Uint8Array;
  speed: FrameSpeed;
  rssi?: number;
  channel?: number;
  retry?: boolean;
}
