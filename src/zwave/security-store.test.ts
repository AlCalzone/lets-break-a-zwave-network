import assert from "node:assert/strict";
import test from "node:test";
import { loadSecurityKeys, saveSecurityKeys, securityStorageKey } from "./security-store";

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
