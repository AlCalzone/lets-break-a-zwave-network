import assert from "node:assert/strict";
import test from "node:test";
import { mainNetworkNodes } from "./network";

test("routing slide puts the dimmer between controller and plug", () => {
  const nodes = mainNetworkNodes("main");
  assert.deepEqual(nodes.map(node => node.nodeId), [1, 3, 2]);
  assert.deepEqual(nodes.map(node => node.label), ["Controller", "Dimmer", "Plug"]);
});
