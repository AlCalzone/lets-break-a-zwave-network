import type { HardwareSecurityOptions } from "./hardware";

export const securityKeyFields = [
  { id: "S0_Legacy", group: "securityKeys", name: "S0_Legacy", label: "S0 Legacy" },
  { id: "S2_Unauthenticated", group: "securityKeys", name: "S2_Unauthenticated", label: "S2 Unauthenticated" },
  { id: "S2_Authenticated", group: "securityKeys", name: "S2_Authenticated", label: "S2 Authenticated" },
  { id: "S2_AccessControl", group: "securityKeys", name: "S2_AccessControl", label: "S2 Access Control" },
  { id: "LR_Authenticated", group: "securityKeysLongRange", name: "S2_Authenticated", label: "Long Range S2 Authenticated" },
  { id: "LR_AccessControl", group: "securityKeysLongRange", name: "S2_AccessControl", label: "Long Range S2 Access Control" },
] as const;

export type SecurityKeyDraft = Partial<Record<(typeof securityKeyFields)[number]["id"], string>>;

export function parseSecurityKeys(draft: SecurityKeyDraft): HardwareSecurityOptions {
  const securityKeys: NonNullable<HardwareSecurityOptions["securityKeys"]> = {};
  const securityKeysLongRange: NonNullable<HardwareSecurityOptions["securityKeysLongRange"]> = {};
  for (const field of securityKeyFields) {
    const hex = draft[field.id]?.trim();
    if (!hex) continue;
    if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`${field.label} needs exactly 32 hexadecimal characters.`);
    const key = Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
    if (field.group === "securityKeys") securityKeys[field.name] = key;
    else securityKeysLongRange[field.name] = key;
  }
  return { securityKeys, securityKeysLongRange };
}
