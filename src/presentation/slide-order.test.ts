import assert from "node:assert/strict";
import test from "node:test";
import { insertRoutingDemo } from "./slide-order";

test("live routing demonstration follows acknowledgments without dropping authored or mock slides", () => {
  const originals = Array.from({ length: 14 }, (_, index) => ({ id: `authored-${index + 1}` }));
  const demos = ["demo-lanes", "demo-frames", "demo-waterfall"].map(id => ({ id }));
  const all = [...originals, ...demos];
  const result = insertRoutingDemo(all, { id: "live-routing" });
  assert.equal(result.length, 18);
  assert.deepEqual(result.slice(5, 8).map(slide => slide.id), ["authored-6", "live-routing", "authored-7"]);
  assert.deepEqual(result.filter(slide => slide.id !== "live-routing"), all);
});

test("missing insertion anchor is an explicit error", () => {
  assert.throws(() => insertRoutingDemo([], { id: "live-routing" }), /acknowledgments slide is missing/);
});
