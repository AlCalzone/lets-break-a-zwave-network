export type RxState = 'unknown' | 'stopped' | 'receiving';
export type ProcessState = 'idle' | 'starting' | 'running' | 'exited' | 'error';

export interface SdrSetup {
  port: string;
  frequencyMHz: number;
  spanMHz: number;
  input?: 'auto' | 'low' | 'high';
}

export type SdrAction =
  | { action: 'launch'; setup: SdrSetup }
  | { action: 'frequency'; value: number }
  | { action: 'span'; value: number }
  | { action: 'rx-start' | 'rx-stop' | 'waterfall' | 'quit' };

export interface SdrState {
  process: ProcessState;
  rx: RxState;
  requestedRx: 'stopped' | 'receiving' | null;
  pending: string | null;
  ready: boolean;
  device: string | null;
  frequencyMHz: number | null;
  spanMHz: number | null;
  setup: SdrSetup | null;
  error: string | null;
  notice: string | null;
}

export type ClientMessage =
  | { type: 'action'; id: string; command: SdrAction }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ack'; sequence: number };

export type ServerMessage =
  | { type: 'state'; state: SdrState }
  | { type: 'snapshot'; data: string; cols: number; rows: number; sequence: number }
  | { type: 'output'; data: string; sequence: number }
  | { type: 'result'; id: string; error?: string };

export const INITIAL_SDR_STATE: SdrState = {
  process: 'idle',
  rx: 'unknown',
  requestedRx: null,
  pending: null,
  ready: false,
  device: null,
  frequencyMHz: null,
  spanMHz: null,
  setup: null,
  error: null,
  notice: null,
};
