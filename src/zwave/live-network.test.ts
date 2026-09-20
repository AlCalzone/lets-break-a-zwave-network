import assert from "node:assert/strict";
import test from "node:test";
import { CommandClasses } from "@zwave-js/core";
import { isLrButtonPress, isNewLrButtonPress } from "./live-network";

test("the LR counter counts Central Scene presses once", () => {
  for (const value of [0, 3, 4, 5, 6]) {
    assert.equal(isLrButtonPress({ commandClass: CommandClasses["Central Scene"], value }), true);
  }
  for (const value of [1, 2]) {
    assert.equal(isLrButtonPress({ commandClass: CommandClasses["Central Scene"], value }), false);
  }
  assert.equal(isLrButtonPress({ commandClass: CommandClasses.Basic, value: 0 }), false);
});

test("the LR counter ignores retransmissions with the previous sequence number", () => {
  const press = { commandClass: CommandClasses["Central Scene"], value: 0, sequenceNumber: 12 };
  assert.equal(isNewLrButtonPress(press, 11), true);
  assert.equal(isNewLrButtonPress(press, 12), false);
  assert.equal(isNewLrButtonPress({ ...press, value: 1 }, 11), false);
});
