import assert from "node:assert/strict";
import test from "node:test";
import { appendDemoFrames, createBaselineFrames, createDemoNodes, createMockExchange, settleMockAction } from "./fixtures";
import { clearDemoCapture, type DemoState } from "./store";

test("clearing capture preserves nodes, scenario, and pending action state", () => {
  for (const scenario of ["healthy", "retry", "no-ack"] as const) {
    for (const pending of [false, true]) {
      const before: DemoState = { nodes: createDemoNodes(), frames: createBaselineFrames(), scenario, pending };
      before.nodes[1].on = true;
      const after = clearDemoCapture(before);
      assert.deepEqual(after.frames, []);
      assert.equal(after.nodes, before.nodes);
      assert.equal(after.nodes[1].on, true);
      assert.equal(after.scenario, scenario);
      assert.equal(after.pending, pending);
      assert.equal(before.frames.length, 4);
      assert.deepEqual(clearDemoCapture(after), after);
    }
  }
});

test("frames arriving after clear continue an exchange without replaying its captured history", () => {
  const nodes = createDemoNodes();
  const exchange = createMockExchange(nodes[1], "on", "healthy", 2, 5);
  const state = clearDemoCapture({
    nodes,
    frames: appendDemoFrames(createBaselineFrames(), exchange.frames.slice(0, 1)),
    scenario: "healthy",
    pending: true,
  });
  const settled = {
    ...state,
    pending: false,
    nodes: settleMockAction(state.nodes, nodes[1], exchange),
    frames: appendDemoFrames(state.frames, exchange.frames.slice(1)),
  };
  assert.equal(settled.nodes[1].on, true);
  assert.deepEqual(settled.frames, exchange.frames.slice(1));
  assert.ok(settled.frames.every(frame => frame.id !== exchange.frames[0].id));

  const cleared = clearDemoCapture(settled);
  const next = createMockExchange(cleared.nodes[1], "off", cleared.scenario, 3, 5 + exchange.frames.length);
  const frames = appendDemoFrames(cleared.frames, next.frames);
  assert.deepEqual(frames, next.frames);
  assert.ok(frames.every(frame => frame.exchangeId === 3));
});
