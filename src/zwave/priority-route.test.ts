import assert from "node:assert/strict";
import test from "node:test";
import { PriorityRouteDemo, type RouteTransport } from "./priority-route";

function transport(events: unknown[]): RouteTransport {
  return {
    async setRoute(repeaters, speed) { events.push({ repeaters, speed }); return true; },
    async send(action) { events.push(action); return "Command acknowledged"; },
  };
}

test("direct and routed demonstrations configure route and speed before sending and reset to none", async () => {
  for (const routed of [false, true]) {
    for (const speed of ["9.6k", "40k", "100k"] as const) {
      for (const action of ["on", "off", "ping"] as const) {
        const events: unknown[] = [];
        const demo = new PriorityRouteDemo();
        await demo.run(transport(events), action, routed, speed);
        assert.deepEqual(events, [{ repeaters: routed ? [3] : [], speed }, action, { repeaters: undefined, speed: undefined }]);
        assert.equal(demo.busy, false);
        assert.equal(demo.cleanupRequired, false);
      }
    }
  }
});

test("failed command still clears priority route", async () => {
  const events: unknown[] = [];
  const link = transport(events);
  link.send = async () => { throw new Error("No ACK"); };
  const demo = new PriorityRouteDemo();
  await assert.rejects(demo.run(link, "ping", true, "40k"), /No ACK/);
  assert.deepEqual(events.at(-1), { repeaters: undefined, speed: undefined });
  assert.equal(demo.cleanupRequired, false);
});

test("capture begins after priority route setup and before the command", async () => {
  const events: unknown[] = [];
  await new PriorityRouteDemo().run(transport(events), "ping", true, "100k", () => events.push("capture"));
  assert.deepEqual(events, [
    { repeaters: [3], speed: "100k" }, "capture", "ping", { repeaters: undefined, speed: undefined },
  ]);
  await assert.rejects(new PriorityRouteDemo().run({
    async setRoute(route) { return route === undefined; },
    async send() { assert.fail("No command after rejected route"); },
  }, "ping", true, "100k", () => assert.fail("No capture after rejected route")));
});

test("failed or rejected route setup never sends but still attempts removal", async () => {
  for (const throws of [true, false]) {
    const events: unknown[] = [];
    const link = transport(events);
    link.setRoute = async (repeaters) => {
      events.push(repeaters);
      if (repeaters) {
        if (throws) throw new Error("Route setup failed");
        return false;
      }
      return true;
    };
    await assert.rejects(new PriorityRouteDemo().run(link, "on", true, "100k"));
    assert.deepEqual(events, [[3], undefined]);
  }
});

test("cleanup failure blocks more commands until explicit recovery succeeds", async () => {
  const events: unknown[] = [];
  const link = transport(events);
  link.setRoute = async (repeaters) => repeaters !== undefined;
  const demo = new PriorityRouteDemo();
  await assert.rejects(demo.run(link, "off", false, "100k"), /cleanup failed/);
  assert.equal(demo.cleanupRequired, true);
  await assert.rejects(demo.run(link, "on", false, "100k"), /Clear the previous/);
  await assert.rejects(demo.clear(link), /did not confirm/);
  assert.equal(demo.cleanupRequired, true);
  await demo.clear(transport(events));
  assert.equal(demo.cleanupRequired, false);
  await demo.run(transport(events), "on", false, "100k");
});

test("cleanup error preserves the command failure", async () => {
  const demo = new PriorityRouteDemo();
  await assert.rejects(demo.run({
    async setRoute(route) { if (!route) throw new Error("Disconnected"); return true; },
    async send() { throw new Error("No ACK"); },
  }, "ping", true, "100k"), /No ACK.*cleanup failed: Disconnected/);
});

test("concurrent demonstrations and cleanup cannot interleave", async () => {
  let release!: () => void;
  const demo = new PriorityRouteDemo();
  const link = transport([]);
  link.send = async () => { await new Promise<void>(resolve => { release = resolve; }); return "OK"; };
  const pending = demo.run(link, "ping", false, "100k");
  await Promise.resolve();
  await assert.rejects(demo.run(link, "off", true, "40k"), /Wait/);
  await assert.rejects(demo.clear(link), /Wait/);
  release();
  await pending;
  assert.equal(demo.busy, false);
});
