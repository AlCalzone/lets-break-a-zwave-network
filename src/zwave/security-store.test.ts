import assert from "node:assert/strict";
import test from "node:test";
import { loadSecurityKeys, saveSecurityKeys, securityStorageKey, withSecurityKeyDefaults } from "./security-store";
import { parseSecurityKeys, securityKeyFields } from "./security-keys";

const fallbackDraft = Object.fromEntries(securityKeyFields.map((field, index) => [
  field.id, (index + 1).toString(16).padStart(2, "0").repeat(16),
]));
const fallback = JSON.stringify(fallbackDraft);

test("missing and empty browser storage use all six fallback keys", () => {
  for (const stored of [null, "{}", '{"S0_Legacy":""}']) {
    assert.deepEqual(loadSecurityKeys({ getItem: () => stored }, fallback), parseSecurityKeys(fallbackDraft));
  }
});

test("saved Classic and LR keys override only their matching defaults", () => {
  const overrides = { S0_Legacy: "ab".repeat(16), LR_Authenticated: "cd".repeat(16) };
  assert.deepEqual(
    loadSecurityKeys({ getItem: () => JSON.stringify(overrides) }, fallback),
    parseSecurityKeys({ ...fallbackDraft, ...overrides }),
  );
});

test("resetting overrides immediately restores defaults and survives reload", () => {
  let stored = JSON.stringify({ S0_Legacy: "ab".repeat(16) });
  const storage = { getItem: () => stored, setItem(_name: string, value: string) { stored = value; } };
  const reset = withSecurityKeyDefaults({}, fallback);
  saveSecurityKeys(storage, {});
  assert.deepEqual(reset, parseSecurityKeys(fallbackDraft));
  assert.deepEqual(loadSecurityKeys(storage, fallback), reset);
});

test("invalid saved keys and fallback keys remain visible errors", () => {
  assert.throws(() => loadSecurityKeys({ getItem: () => '{"S0_Legacy":"bad"}' }, fallback), /32 hexadecimal/);
  assert.throws(() => loadSecurityKeys({ getItem: () => null }, "invalid"), /Fallback network keys contain invalid JSON/);
  assert.throws(() => loadSecurityKeys({ getItem() { throw new Error("Storage is blocked"); } }, fallback), /Storage is blocked/);
});

test("classic and LR keys survive a new reader using persisted storage", () => {
  const values = new Map<string, string>();
  const options = {
    securityKeys: { S0_Legacy: Uint8Array.from({ length: 16 }, (_, index) => index) },
    securityKeysLongRange: { S2_Authenticated: Uint8Array.from({ length: 16 }, (_, index) => 255 - index) },
  };
  saveSecurityKeys({ setItem: (name, value) => { values.set(name, value); } }, options);
  assert.deepEqual(loadSecurityKeys({ getItem: name => values.get(name) ?? null }), options);
  saveSecurityKeys({ setItem: (name, value) => { values.set(name, value); } }, {});
  assert.deepEqual(loadSecurityKeys({ getItem: name => values.get(name) ?? null }), { securityKeys: {}, securityKeysLongRange: {} });
  assert.equal(values.size, 1);
  assert.ok(values.has(securityStorageKey));
});

test("invalid saved keys surface errors without disclosing their contents", () => {
  assert.equal(loadSecurityKeys({ getItem: () => null }), undefined);
  for (const value of ['{"S0_Legacy":"private-value"', 'null', '[]', '{"unknown":"private-value"}', '{"S0_Legacy":1}', '{"S0_Legacy":"private-value"}']) {
    assert.throws(() => loadSecurityKeys({ getItem: () => value }), error => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes("private-value"));
      return true;
    });
  }
});

test("storage failures propagate instead of reporting saved keys", () => {
  assert.throws(() => saveSecurityKeys({ setItem() { throw new Error("Storage is blocked"); } }, {}), /Storage is blocked/);
  assert.throws(() => loadSecurityKeys({ getItem() { throw new Error("Storage is blocked"); } }), /Storage is blocked/);
});
