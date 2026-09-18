import { useEffect, useRef, type ReactNode } from "react";
import "./setup.css";

export interface ConnectionRow {
  id: string;
  label: string;
  status: string;
  detail?: string;
  error?: string;
  connected: boolean;
  busy: boolean;
  connect(): void;
  disconnect(): void;
  remove?: () => void;
  reinterview?: () => void;
  canReinterview?: boolean;
}

export interface HardwareSetupProps {
  rows: ConnectionRow[];
  canPresent: boolean;
  browserSupported: boolean;
  onAddRcp(): void;
  onPresent(): void;
  onClose(): void;
  children?: ReactNode;
}

export function HardwareSetup(props: HardwareSetupProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} className="hardware-setup" aria-labelledby="hardware-title"
      onCancel={event => { event.preventDefault(); props.onClose(); }}>
      <header>
        <div>
          <h1 id="hardware-title">Connect the network</h1>
        </div>
        <button type="button" className="setup-close" aria-label="Close connections" onClick={props.onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      {!props.browserSupported && <p className="setup-error" role="alert">Web Serial is unavailable. Open this presentation in desktop Chrome or Edge on localhost.</p>}
      <p className="setup-note">Radio: EU Long Range · Zniffer: Classic + LR A</p>
      {props.rows.map(row => (
        <section key={row.id} className="setup-device" aria-label={row.label}>
          <div>
            <h2>{row.label}</h2>
            <p className="setup-status" role="status">{row.status}</p>
            {row.detail && <p>{row.detail}</p>}
            {row.error && <p className="setup-error" role="alert">{row.error}</p>}
          </div>
          <div className="setup-buttons">
            {row.reinterview && <button type="button" disabled={row.busy || !row.canReinterview}
              onClick={row.reinterview}>Re-interview all</button>}
            {row.connected
              ? <button type="button" disabled={row.busy} onClick={row.disconnect}>Disconnect</button>
              : <button type="button" disabled={row.busy || !props.browserSupported} onClick={row.connect}>Connect</button>}
            {row.remove && <button type="button" disabled={row.busy || row.connected} onClick={row.remove}>Remove</button>}
          </div>
        </section>
      ))}
      <button type="button" className="setup-add" onClick={props.onAddRcp}>Add RCP</button>
      {props.children}
      <footer>
        <button type="button" className="setup-present" disabled={!props.canPresent} onClick={props.onPresent}>Start presentation</button>
      </footer>
    </dialog>
  );
}
