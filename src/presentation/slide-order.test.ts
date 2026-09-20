import assert from "node:assert/strict";
import test from "node:test";
import { insertRoutingDemos } from "./slide-order";

test("live routing demos follow acknowledgments and explorer recovery without dropping other slides", () => {
  const originals = Array.from({ length: 14 }, (_, index) => ({ id: `authored-${index + 1}` }));
  const result = insertRoutingDemos(originals, { id: "live-routing" }, undefined,
    { id: "live-beaming" }, { id: "live-rcp-control" }, { id: "live-jamming" },
    { id: "live-beam-jamming" }, { id: "live-return-route-relay" });
  assert.equal(result.length, 21);
  assert.deepEqual(result.slice(5, 8).map(slide => slide.id), ["authored-6", "live-routing", "authored-7"]);
  assert.deepEqual(result.slice(10, 13).map(slide => slide.id), ["authored-10", "live-routing-explorers", "authored-11"]);
  assert.deepEqual(result.slice(14, 17).map(slide => slide.id), ["authored-13", "live-beaming", "authored-14"]);
  assert.deepEqual(result.slice(16, 21).map(slide => slide.id),
    ["authored-14", "live-rcp-control", "live-jamming", "live-beam-jamming", "live-return-route-relay"]);
  assert.deepEqual(result.filter(slide => !slide.id.startsWith("live-")), originals);
  assert.equal(new Set(result.map(slide => slide.id)).size, result.length);
});

test("missing insertion anchor is an explicit error", () => {
  assert.throws(() => insertRoutingDemos([], { id: "live-routing" }), /acknowledgments slide is missing/);
  assert.throws(() => insertRoutingDemos([{ id: "authored-6" }], { id: "live-routing" }), /explorer recovery slide is missing/);
  assert.throws(() => insertRoutingDemos([{ id: "authored-6" }, { id: "authored-10" }],
    { id: "live-routing" }, undefined, { id: "live-beaming" }), /beaming slide is missing/);
  assert.throws(() => insertRoutingDemos([{ id: "authored-6" }, { id: "authored-10" }, { id: "authored-13" }],
    { id: "live-routing" }, undefined, undefined, { id: "live-rcp-control" }), /live setup slide is missing/);
  assert.throws(() => insertRoutingDemos(
    [{ id: "authored-6" }, { id: "authored-10" }, { id: "authored-13" }, { id: "authored-14" }],
    { id: "live-routing" }, undefined, undefined, undefined, { id: "live-jamming" },
  ), /RCP control slide is required/);
  assert.throws(() => insertRoutingDemos(
    [{ id: "authored-6" }, { id: "authored-10" }, { id: "authored-13" }, { id: "authored-14" }],
    { id: "live-routing" }, undefined, undefined, { id: "live-rcp-control" }, undefined,
    { id: "live-beam-jamming" },
  ), /frame-jamming slide is required/);
  assert.throws(() => insertRoutingDemos(
    [{ id: "authored-6" }, { id: "authored-10" }, { id: "authored-13" }, { id: "authored-14" }],
    { id: "live-routing" }, undefined, undefined, { id: "live-rcp-control" }, { id: "live-jamming" },
    undefined, { id: "live-return-route-relay" },
  ), /beam-jamming slide is required/);
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
