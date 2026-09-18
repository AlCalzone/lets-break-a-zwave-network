import { useEffect, useState } from 'react';
import { terminalStore, useSdrState } from '../../terminal/store';
import './terminal.css';

export interface SdrControlsProps { className?: string }

export function SdrControls({ className = '' }: SdrControlsProps) {
  const { connected, connecting, state, localError, sending } = useSdrState();
  const [draft, setDraft] = useState(terminalStore.draft);
  useEffect(() => { terminalStore.ensure(); }, []);
  useEffect(() => {
    if (!state.setup || terminalStore.draft.port) return;
    const next = {
      port: state.setup.port,
      frequencyMHz: String(state.setup.frequencyMHz),
      spanMHz: String(state.setup.spanMHz),
      input: state.setup.input ?? 'auto' as const,
    };
    terminalStore.draft = next;
    setDraft(next);
  }, [state.setup]);
  const change = (key: keyof typeof draft, value: string) => {
    const next = { ...draft, [key]: value } as typeof draft;
    terminalStore.draft = next;
    setDraft(next);
  };
  const busy = sending || state.pending !== null;
  const running = state.process === 'running' || state.process === 'starting';
  const ready = connected && state.ready && !busy;
  const number = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0.000001 && Number(value) <= 12000;
  const valid = draft.port.trim() !== '' && number(draft.frequencyMHz) && number(draft.spanMHz);
  const error = localError || state.error;
  return (
    <div className={`sdr-controls ${className}`} data-deck-interactive>
      <div className="sdr-setup-row">
        <label className="sdr-port-field">tinySA serial port
          <input value={draft.port} onChange={(e) => change('port', e.target.value)} placeholder="/dev/ttyACM0"
            autoComplete="off" spellCheck={false} disabled={running || busy} aria-label="tinySA serial port" />
        </label>
        <label>Center / MHz
          <input type="number" min="0.000001" max="12000" step="any" value={draft.frequencyMHz}
            onChange={(e) => change('frequencyMHz', e.target.value)} placeholder="Required" disabled={busy} aria-label="Center frequency in MHz" />
        </label>
        <label>Span / MHz
          <input type="number" min="0.000001" max="12000" step="any" value={draft.spanMHz}
            onChange={(e) => change('spanMHz', e.target.value)} placeholder="Required" disabled={busy} aria-label="Frequency span in MHz" />
        </label>
        <label>tinySA input
          <select value={draft.input} onChange={(e) => change('input', e.target.value)} disabled={running || busy} aria-label="tinySA input">
            <option value="auto">Auto / Ultra</option>
            <option value="low">Basic · Low</option>
            <option value="high">Basic · High</option>
          </select>
        </label>
        <button type="button" disabled={!connected || busy || running || !valid}
          onClick={() => terminalStore.action({ action: 'launch', setup: {
            port: draft.port.trim(), frequencyMHz: Number(draft.frequencyMHz), spanMHz: Number(draft.spanMHz), input: draft.input,
          } })}>Launch sdrtop</button>
      </div>
      <div className="sdr-action-row">
        <button className="sdr-start" type="button" disabled={!ready || state.rx !== 'stopped'}
          onClick={() => terminalStore.action({ action: 'rx-start' })}>Start RX</button>
        <button type="button" disabled={!ready || state.rx !== 'receiving'}
          onClick={() => terminalStore.action({ action: 'rx-stop' })}>Stop RX</button>
        <button type="button" disabled={!ready} onClick={() => terminalStore.action({ action: 'waterfall' })}>Waterfall</button>
        <button type="button" disabled={!ready || !number(draft.frequencyMHz)}
          onClick={() => terminalStore.action({ action: 'frequency', value: Number(draft.frequencyMHz) })}>Set center</button>
        <button type="button" disabled={!ready || !number(draft.spanMHz)}
          onClick={() => terminalStore.action({ action: 'span', value: Number(draft.spanMHz) })}>Set span</button>
        <button className="sdr-quit" type="button" disabled={!connected || busy || !running}
          onClick={() => terminalStore.action({ action: 'quit' })}>Quit process</button>
        <span className="sdr-connection-label">{busy ? `${state.pending || 'Sending'}…`
          : connecting ? 'Connecting…' : !connected ? 'Offline' : state.device || 'Local service ready'}</span>
      </div>
      <div className={`sdr-feedback ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>
        {error || state.notice || (state.frequencyMHz !== null
          ? `Observed header: ${state.frequencyMHz} MHz center · ${state.spanMHz ?? '?'} MHz span · RX ${state.rx}`
          : 'Launch once to save the receiver settings. Future service starts launch sdrtop and begin reception automatically.')}
      </div>
    </div>
  );
}
