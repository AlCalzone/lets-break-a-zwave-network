import assert from "node:assert/strict";
import test from "node:test";
import { navigationTarget } from "./navigation";

test("arrows navigate without wrapping", () => {
  assert.equal(navigationTarget("ArrowLeft", 0, 17), 0);
  assert.equal(navigationTarget("ArrowRight", 16, 17), 16);
  assert.equal(navigationTarget("ArrowRight", 13, 17), 14);
  assert.equal(navigationTarget("ArrowLeft", 14, 17), 13);
});

test("button activation and text-entry keys do not navigate", () => {
  for (const key of [" ", "Enter", "r", "1", "Escape"]) {
    assert.equal(navigationTarget(key, 5, 17), undefined);
  }
});
