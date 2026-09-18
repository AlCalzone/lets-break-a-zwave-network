import assert from "node:assert/strict";
import test from "node:test";
import { mainDriverOptions } from "./driver-options";
import { requiredRegion } from "./radio-config";

test("all Driver transmissions default to one send attempt, including jammed transmissions", () => {
  const options = mainDriverOptions("/test-cache");
  assert.deepEqual(options.attempts, { sendData: 1, sendDataJammed: 1 });
  assert.deepEqual(options.storage, { cacheDir: "/test-cache" });
  assert.deepEqual(options.rf, { region: requiredRegion, preferLRRegion: false });
});

test("security configuration preserves the single-attempt default", () => {
  const security = {
    securityKeys: { S0_Legacy: Uint8Array.from({ length: 16 }, (_, index) => index) },
    securityKeysLongRange: { S2_Authenticated: Uint8Array.from({ length: 16 }, (_, index) => 255 - index) },
  };
  const options = mainDriverOptions("/test-cache", security);
  assert.deepEqual(options.securityKeys, security.securityKeys);
  assert.deepEqual(options.securityKeysLongRange, security.securityKeysLongRange);
  assert.equal(options.attempts?.sendData, 1);
  assert.equal(options.attempts?.sendDataJammed, 1);
});
