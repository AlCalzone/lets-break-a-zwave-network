import assert from "node:assert/strict";
import test from "node:test";
import { parseSecurityKeys, securityKeyFields } from "./security-keys";

test("existing keys decode into separate classic and Long Range groups", () => {
  const hex = "00112233445566778899AABBCCDDEEFF";
  const options = parseSecurityKeys(Object.fromEntries(securityKeyFields.map(field => [field.id, hex])));
  assert.equal(Object.keys(options.securityKeys ?? {}).length, 4);
  assert.equal(Object.keys(options.securityKeysLongRange ?? {}).length, 2);
  for (const key of [...Object.values(options.securityKeys ?? {}), ...Object.values(options.securityKeysLongRange ?? {})]) {
    assert.equal(Buffer.from(key).toString("hex"), hex.toLowerCase());
  }
});

test("blank fields never generate replacement network keys", () => {
  assert.deepEqual(parseSecurityKeys({ S0_Legacy: " " }), { securityKeys: {}, securityKeysLongRange: {} });
});

test("invalid keys identify the field without revealing its contents", () => {
  for (const value of ["private-invalid-value", "00", "0".repeat(33)]) {
    assert.throws(() => parseSecurityKeys({ S0_Legacy: value }), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^S0 Legacy needs exactly 32 hexadecimal characters\.$/);
      assert.ok(!error.message.includes(value));
      return true;
    });
  }
});
