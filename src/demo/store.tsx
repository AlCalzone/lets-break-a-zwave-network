import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { DemoFrame, DemoNode, NodeAction, Scenario } from "./types";
import {
  appendDemoFrames,
  createBaselineFrames,
  createDemoNodes,
  createMockExchange,
  DEMO_ACTION_DELAY_MS,
  settleMockAction,
} from "./fixtures";

export interface DemoState {
  nodes: DemoNode[];
  frames: DemoFrame[];
  scenario: Scenario;
  pending: boolean;
}

export interface DemoStore extends DemoState {
  setScenario: (scenario: Scenario) => void;
  performAction: (nodeId: string, action: NodeAction) => void;
  clearCapture: () => void;
  reset: () => void;
}

const DemoContext = createContext<DemoStore | null>(null);

function initialState(): DemoState {
  return { nodes: createDemoNodes(), frames: createBaselineFrames(), scenario: "healthy", pending: false };
}

export function clearDemoCapture(state: DemoState): DemoState {
  return { ...state, frames: [] };
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(initialState);
  const current = useRef(state);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exchangeNumber = useRef(1);
  const nextSequence = useRef(state.frames.length + 1);

  const update = useCallback((next: DemoState) => {
    current.current = next;
    setState(next);
  }, []);

  const cancelPending = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => cancelPending, [cancelPending]);

  const reset = useCallback(() => {
    cancelPending();
    exchangeNumber.current = 1;
    const next = initialState();
    nextSequence.current = next.frames.length + 1;
    update(next);
  }, [cancelPending, update]);

  const setScenario = useCallback((scenario: Scenario) => {
    if (current.current.pending) return;
    update({ ...current.current, scenario });
  }, [update]);

  const clearCapture = useCallback(() => {
    update(clearDemoCapture(current.current));
  }, [update]);

  const performAction = useCallback((nodeId: string, action: NodeAction) => {
    if (current.current.pending) return;
    const node = current.current.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;

    const exchange = createMockExchange(node, action, current.current.scenario, ++exchangeNumber.current, nextSequence.current);
    nextSequence.current += exchange.frames.length;
    update({
      ...current.current,
      pending: true,
      nodes: current.current.nodes.map((candidate) =>
        candidate.id === nodeId ? { ...candidate, outcome: { kind: "pending", label: "Pending", detail: "mock exchange" } } : candidate,
      ),
      frames: appendDemoFrames(current.current.frames, exchange.frames.slice(0, 1)),
    });

    timer.current = setTimeout(() => {
      timer.current = null;
      update({
        ...current.current,
        pending: false,
        nodes: settleMockAction(current.current.nodes, node, exchange),
        frames: appendDemoFrames(current.current.frames, exchange.frames.slice(1)),
      });
    }, DEMO_ACTION_DELAY_MS);
  }, [update]);

  return <DemoContext.Provider value={{ ...state, setScenario, performAction, clearCapture, reset }}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoStore {
  const context = useContext(DemoContext);
  if (!context) throw new Error("useDemo must be used within DemoProvider");
  return context;
}
