import type { HardwareSecurityOptions } from "./hardware";
import { parseSecurityKeys, securityKeyFields, type SecurityKeyDraft } from "./security-keys";

export const securityStorageKey = "zwave-presentation.security-keys.v1";

function parseStoredKeys(text: string, source: string): HardwareSecurityOptions {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error(`${source} contain invalid JSON.`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source} have an invalid format.`);
  }
  const draft: SecurityKeyDraft = {};
  for (const [name, key] of Object.entries(value)) {
    const field = securityKeyFields.find(field => field.id === name);
    if (!field || typeof key !== "string") throw new Error(`${source} have an invalid field.`);
    draft[field.id] = key;
  }
  return parseSecurityKeys(draft);
}

export function withSecurityKeyDefaults(options: HardwareSecurityOptions, fallback?: string): HardwareSecurityOptions {
  if (!fallback) return options;
  const defaults = parseStoredKeys(fallback, "Fallback network keys");
  return {
    securityKeys: { ...defaults.securityKeys, ...options.securityKeys },
    securityKeysLongRange: { ...defaults.securityKeysLongRange, ...options.securityKeysLongRange },
  };
}

export function loadSecurityKeys(storage: Pick<Storage, "getItem">, fallback?: string): HardwareSecurityOptions | undefined {
  const text = storage.getItem(securityStorageKey);
  if (text === null && !fallback) return undefined;
  return withSecurityKeyDefaults(text === null ? {} : parseStoredKeys(text, "Saved network keys"), fallback);
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
