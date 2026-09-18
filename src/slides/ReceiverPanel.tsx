import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SdrControls, TerminalPanel } from "../components/terminal";
import "./receiver.css";

export function ReceiverPanel() {
  const [setupOpen, setSetupOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (setupOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [setupOpen]);

  return (
    <div className="receiver-panel">
      <TerminalPanel className="demo-terminal" waterfallOnly headerActions={
        <button className="receiver-configure" type="button" aria-label="Configure receiver"
          aria-haspopup="dialog" onClick={() => setSetupOpen(true)}>Configure</button>
      } />
      {createPortal(
        <dialog ref={dialog} className="receiver-dialog" onClose={() => setSetupOpen(false)} aria-labelledby="receiver-title">
          <header>
            <div><h2 id="receiver-title">tinySA receiver</h2><p>Local sdrtop process · real RF measurements</p></div>
            <button onClick={() => setSetupOpen(false)} aria-label="Close receiver setup">Close</button>
          </header>
          <SdrControls />
        </dialog>,
        document.body,
      )}
    </div>
  );
}
