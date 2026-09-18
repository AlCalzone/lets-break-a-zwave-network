import assert from "node:assert/strict";
import test from "node:test";
import {
  actionsByNode,
  appendDemoFrames,
  createBaselineFrames,
  createDemoNodes,
  createMockExchange,
  MAX_DEMO_FRAMES,
  settleMockAction,
} from "./fixtures";
import type { NodeAction, Scenario } from "./types";

test("baseline has fresh network-scoped nodes and a deterministic routed exchange", () => {
  const nodes = createDemoNodes();
  assert.deepEqual(nodes.map((node) => node.id), ["demo:1", "demo:2", "demo:3", "demo:7"]);
  assert.deepEqual(createBaselineFrames().map((frame) => [frame.source, frame.target, frame.timestampMs]), [
    [1, 2, 0], [2, 3, 4.1], [3, 2, 9.8], [2, 1, 13.2],
  ]);
  assert.deepEqual(createBaselineFrames(), createBaselineFrames());
  nodes[0].outcome.label = "changed";
  assert.equal(createDemoNodes()[0].outcome.label, "ACK");
});

test("every available action produces consecutive hops and stable routes in every scenario", () => {
  const scenarios: Scenario[] = ["healthy", "retry", "no-ack"];
  for (const node of createDemoNodes()) {
    for (const action of actionsByNode[node.id]) {
      for (const scenario of scenarios) {
        const exchange = createMockExchange(node, action, scenario, 9, 30);
        const route = exchange.frames[0].route;
        assert.equal(exchange.outcome.kind, scenario === "no-ack" ? "error" : "success");
        for (const [index, frame] of exchange.frames.entries()) {
          assert.deepEqual(frame.route, route);
          assert.equal(Math.abs(route.indexOf(frame.source) - route.indexOf(frame.target)), 1);
          assert.equal(frame.networkId, node.networkId);
          assert.equal(frame.sequence, 30 + index);
          assert.equal(frame.exchangeId, 9);
          if (index) assert.ok(frame.timestampMs >= exchange.frames[index - 1].timestampMs);
        }
        if (scenario === "no-ack") {
          assert.ok(exchange.frames.every((frame) => !frame.kind.includes("ACK")));
          assert.ok(exchange.frames.some((frame) => frame.retry));
        } else {
          assert.ok(exchange.frames.some((frame) => frame.kind.includes("ACK")));
        }
      }
    }
  }
});

test("report and wake originate at the selected device and acknowledgments return to it", () => {
  for (const [nodeId, action] of [[3, "report"], [7, "wake"]] as const) {
    const node = createDemoNodes().find((candidate) => candidate.nodeId === nodeId)!;
    const { frames } = createMockExchange(node, action, "healthy", 2, 5);
    assert.equal(frames[0].source, nodeId);
    assert.deepEqual(frames[0].route, [nodeId, 2, 1]);
    assert.equal(frames[frames.length - 1].target, nodeId);
  }
});

test("only confirmed commands change the plug state", () => {
  for (const action of ["on", "off"] as NodeAction[]) {
    for (const scenario of ["healthy", "retry", "no-ack"] as Scenario[]) {
      const nodes = createDemoNodes();
      nodes[1].on = action === "off";
      const exchange = createMockExchange(nodes[1], action, scenario, 2, 5);
      const next = settleMockAction(nodes, nodes[1], exchange);
      assert.equal(next[1].on, scenario === "no-ack" ? nodes[1].on : action === "on");
      assert.equal(nodes[1].on, action === "off");
    }
  }
});

test("controller switch commands target the plug without changing another network", () => {
  const nodes = createDemoNodes();
  nodes.push({ ...nodes[1], id: "other:2", networkId: "other" });
  const exchange = createMockExchange(nodes[0], "on", "healthy", 2, 5);
  const next = settleMockAction(nodes, nodes[0], exchange);
  assert.deepEqual(exchange.frames[0].route, [1, 2]);
  assert.equal(next[1].on, true);
  assert.equal(next[4].on, false);
  assert.equal(next[0].outcome.kind, "success");
  assert.equal(next[1].outcome.kind, "success");
});

test("retry acknowledgments keep the successful attempt's channel and speed", () => {
  const exchange = createMockExchange(createDemoNodes()[1], "on", "retry", 2, 5);
  const ack = exchange.frames.find((frame) => frame.kind === "ACK")!;
  assert.equal(ack.channel, 1);
  assert.equal(ack.speed, "40k");
  assert.equal(exchange.frames.filter((frame) => frame.source === 1 && frame.kind === "DATA").length, 2);
  assert.equal(exchange.frames.find((frame) => frame.source === 2 && frame.kind === "DATA")?.retry, false);
});

test("frame history stays bounded without mutating existing frames", () => {
  const initial = createBaselineFrames();
  let frames = initial;
  for (let exchange = 2; exchange < 30; exchange++) {
    frames = appendDemoFrames(frames, createMockExchange(createDemoNodes()[0], "basic-set", "retry", exchange, exchange * 10).frames);
  }
  assert.equal(frames.length, MAX_DEMO_FRAMES);
  assert.equal(initial.length, 4);
  assert.equal(new Set(frames.map((frame) => frame.id)).size, MAX_DEMO_FRAMES);
  assert.equal(frames[frames.length - 1].exchangeId, 29);
});

test("mock actions carry deterministic command bytes across hops and retries", () => {
  const expected: Record<NodeAction, number[]> = {
    on: [0x25, 0x01, 0xff],
    off: [0x25, 0x01, 0x00],
    "basic-set": [0x20, 0x01, 0xff],
    ping: [0x00],
    report: [0x20, 0x03, 0xff],
    wake: [0x84, 0x07],
  };
  for (const node of createDemoNodes()) {
    for (const action of actionsByNode[node.id]) {
      for (const scenario of ["healthy", "retry", "no-ack"] as const) {
        const { frames } = createMockExchange(node, action, scenario, 2, 5);
        for (const frame of frames) {
          assert.ok(frame.payload instanceof Uint8Array);
          const isSwitchReport = (action === "on" || action === "off") && frame.source === 2;
          assert.deepEqual(Array.from(frame.payload), frame.kind.endsWith("DATA")
            ? isSwitchReport ? [0x25, 0x03, action === "on" ? 0xff : 0x00] : expected[action]
            : []);
        }
      }
    }
  }
});

test("payload buffers are independent across frames and fixture calls", () => {
  const frames = createBaselineFrames();
  frames[0].payload[0] = 0xff;
  assert.equal(frames[1].payload[0], 0x20);
  assert.equal(createBaselineFrames()[0].payload[0], 0x20);
});
