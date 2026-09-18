import { useState } from "react";
import type { HardwareSecurityOptions } from "./hardware";
import { errorMessage } from "./priority-route";
import { parseSecurityKeys, securityKeyFields, type SecurityKeyDraft } from "./security-keys";

export function SecurityKeysForm({ disabled, configured, hasDefaults = false, onApply }: {
  disabled: boolean;
  configured: readonly string[];
  hasDefaults?: boolean;
  onApply(options: HardwareSecurityOptions): void;
}) {
  const [draft, setDraft] = useState<SecurityKeyDraft>({});
  const [error, setError] = useState("");
  const apply = (values: SecurityKeyDraft) => {
    try {
      onApply(parseSecurityKeys(values));
      setDraft({});
      setError("");
    } catch (error) { setError(errorMessage(error)); }
  };
  return <details>
    <summary>Network security keys</summary>
    {configured.length > 0 && <p>Configured: {configured.join(", ")}</p>}
    {disabled && <p>Disconnect controller and Zniffer to edit.</p>}
    <form onSubmit={event => {
      event.preventDefault();
      apply(draft);
    }}>
      <div className="setup-keys">
        {securityKeyFields.map(field => <label key={field.id}>
          {field.label}
          <input type="password" autoComplete="off" spellCheck={false} disabled={disabled}
            value={draft[field.id] ?? ""} placeholder="32 hexadecimal characters"
            onChange={event => setDraft(current => ({ ...current, [field.id]: event.target.value }))} />
        </label>)}
      </div>
      {error && <p className="setup-error" role="alert">{error}</p>}
      <div className="setup-key-actions">
        <button type="submit" disabled={disabled || !Object.values(draft).some(value => value.trim())}>{configured.length ? "Replace keys" : "Save keys"}</button>
        {configured.length > 0 && <button type="button" disabled={disabled} onClick={() => apply({})}>{hasDefaults ? "Reset to defaults" : "Clear saved keys"}</button>}
      </div>
    </form>
  </details>;
}
