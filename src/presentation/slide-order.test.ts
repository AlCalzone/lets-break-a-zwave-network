import assert from "node:assert/strict";
import test from "node:test";
import { insertRoutingDemos } from "./slide-order";

test("live routing demos follow acknowledgments and explorer recovery without dropping other slides", () => {
  const originals = Array.from({ length: 14 }, (_, index) => ({ id: `authored-${index + 1}` }));
  const demos = ["demo-lanes", "demo-frames", "demo-waterfall"].map(id => ({ id }));
  const all = [...originals, ...demos];
  const result = insertRoutingDemos(all, { id: "live-routing" });
  assert.equal(result.length, 19);
  assert.deepEqual(result.slice(5, 8).map(slide => slide.id), ["authored-6", "live-routing", "authored-7"]);
  assert.deepEqual(result.slice(10, 13).map(slide => slide.id), ["authored-10", "live-routing-explorers", "authored-11"]);
  assert.deepEqual(result.filter(slide => !slide.id.startsWith("live-routing")), all);
  assert.equal(new Set(result.map(slide => slide.id)).size, result.length);
});

test("missing insertion anchor is an explicit error", () => {
  assert.throws(() => insertRoutingDemos([], { id: "live-routing" }), /acknowledgments slide is missing/);
  assert.throws(() => insertRoutingDemos([{ id: "authored-6" }], { id: "live-routing" }), /explorer recovery slide is missing/);
});

test("the copied slide keeps the same content, title, and notes with a distinct ID", () => {
  const demo = { id: "live-routing", title: "Let's see it in action", notes: "Live controls", content: {} };
  const result = insertRoutingDemos([{ ...demo, id: "authored-6" }, { ...demo, id: "authored-10" }], demo);
  assert.deepEqual(result[3], { ...demo, id: "live-routing-explorers" });
  assert.equal(result[1].content, result[3].content);
});

test("the encore can use its own title without changing the first demo", () => {
  const demo = { id: "live-routing", title: "Let's see it in action" };
  const encore = { id: "live-routing-explorers", title: "Let's see it in action once more" };
  const result = insertRoutingDemos([{ ...demo, id: "authored-6" }, { ...demo, id: "authored-10" }], demo, encore);
  assert.equal(result[1], demo);
  assert.equal(result[3], encore);
});
