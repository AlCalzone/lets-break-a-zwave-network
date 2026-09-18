import { useEffect, useRef, type ReactNode } from 'react';
import '@xterm/xterm/css/xterm.css';
import { terminalStore, useSdrState } from '../../terminal/store';
import './terminal.css';

export interface TerminalPanelProps {
  className?: string;
  chrome?: boolean;
  waterfallOnly?: boolean;
  headerActions?: ReactNode;
}

export function TerminalPanel({ className = '', chrome = true, waterfallOnly = false, headerActions }: TerminalPanelProps) {
  const container = useRef<HTMLDivElement>(null);
  const { connected, state, localError, waterfallAvailable } = useSdrState();
  useEffect(() => {
    terminalStore.ensure();
    const parent = container.current;
    if (!parent) return;
    const slide = parent.closest('.slide-slot');
    let detach: (() => void) | undefined;
    const attachVisible = () => {
      if (!slide || slide.hasAttribute('data-deck-active')) {
        detach ??= terminalStore.attach(parent, waterfallOnly);
      } else {
        detach?.();
        detach = undefined;
      }
    };
    const observer = new MutationObserver(attachVisible);
    if (slide) observer.observe(slide, { attributes: true, attributeFilter: ['data-deck-active'] });
    attachVisible();
    return () => { observer.disconnect(); detach?.(); };
  }, [waterfallOnly]);
  const error = localError || state.error;
  const receiving = connected && state.process === 'running' && state.rx === 'receiving';
  const label = !connected ? 'SERVICE DISCONNECTED' : state.process === 'idle' ? 'NOT LAUNCHED'
    : state.pending ? state.pending.toUpperCase() : error ? 'RECEIVER ERROR' : receiving ? 'LIVE · RX'
      : state.rx === 'stopped' ? 'RX STOPPED' : state.process === 'exited' ? 'PROCESS EXITED' : 'STATE UNKNOWN';
  return (
    <section className={`sdr-panel ${className}`} aria-label="sdrtop receiver terminal">
      {chrome && <div className="sdr-panel-chrome">
        <span className="sdr-panel-title">sdrtop <span>/ tinySA</span></span>
        <div className="sdr-panel-actions">
          <span className={`sdr-panel-status ${receiving ? 'is-live' : ''}`}>{label}</span>
          {headerActions}
        </div>
      </div>}
      <div className="sdr-terminal-viewport" ref={container} aria-label={waterfallOnly ? 'Live waterfall frame' : 'Read-only terminal output'} />
      {(state.process === 'idle' || (waterfallOnly && !waterfallAvailable)) && <div className="sdr-empty">
        <strong>tinySA receiver</strong>
        <span>{state.process === 'running' || state.process === 'starting'
          ? 'Waiting for the waterfall frame…'
          : state.process === 'idle'
            ? 'Configure the receiver once to enable automatic startup.'
            : 'Open Configure to launch sdrtop, then start RX.'}</span>
      </div>}
      {error && <div className="sdr-panel-error" role="alert">{error}</div>}
    </section>
  );
}
