import type { HardwareSecurityOptions } from "./hardware";
import { parseSecurityKeys, securityKeyFields, type SecurityKeyDraft } from "./security-keys";

export const securityStorageKey = "zwave-presentation.security-keys.v1";

export function loadSecurityKeys(storage: Pick<Storage, "getItem">): HardwareSecurityOptions | undefined {
  const text = storage.getItem(securityStorageKey);
  if (text === null) return undefined;
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error("Saved network keys contain invalid JSON. Replace them in connection setup."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Saved network keys have an invalid format. Replace them in connection setup.");
  }
  const draft: SecurityKeyDraft = {};
  for (const [name, key] of Object.entries(value)) {
    const field = securityKeyFields.find(field => field.id === name);
    if (!field || typeof key !== "string") throw new Error("Saved network keys have an invalid field. Replace them in connection setup.");
    draft[field.id] = key;
  }
  return parseSecurityKeys(draft);
}

export function saveSecurityKeys(storage: Pick<Storage, "setItem">, options: HardwareSecurityOptions) {
  const draft: SecurityKeyDraft = {};
  for (const field of securityKeyFields) {
    const key = field.group === "securityKeys" ? options.securityKeys?.[field.name] : options.securityKeysLongRange?.[field.name];
    if (key) draft[field.id] = Array.from(key, byte => byte.toString(16).padStart(2, "0")).join("");
  }
  parseSecurityKeys(draft);
  storage.setItem(securityStorageKey, JSON.stringify(draft));
}
