import { createContext, useContext } from "react";

export const ConnectionsContext = createContext<{ ready: boolean; open(): void } | null>(null);

export function ConnectionsLink({ placement = "header" }: { placement?: "header" | "title" }) {
  const connections = useContext(ConnectionsContext);
  if (!connections) throw new Error("Interactive slides require a ConnectionsContext provider.");
  return <button type="button" className={`connections-link ${placement}-connections`}
    aria-label="Open connections" aria-haspopup="dialog"
    title={`Connections · ${connections.ready ? "Ready" : "Not ready"}`}
    data-ready={connections.ready} onClick={connections.open}>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2" />
    </svg>
  </button>;
}
