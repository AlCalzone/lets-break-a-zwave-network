import assert from "node:assert/strict";
import test from "node:test";
import { SupervisionStatus, ZWaveDataRate } from "@zwave-js/core";
import { createPlugTransport } from "./plug-transport";
import { PriorityRouteDemo } from "./priority-route";

test("plug uses the Binary Switch commandClasses API between priority setup and removal", async () => {
  const events: unknown[] = [];
  const transport = createPlugTransport({
    async setPriorityRoute(...args) { events.push(["route", ...args]); return true; },
    async removePriorityRoute(id) { events.push(["clear", id]); return true; },
  }, {
    async ping() { events.push("ping"); return true; },
    commandClasses: { "Binary Switch": {
      async set(value) { events.push(["set", value]); return { status: SupervisionStatus.Success }; },
    } },
  }, value => events.push(["report", value]));
  assert.equal(await new PriorityRouteDemo().run(transport, "on", true, "40k"), "On confirmed");
  assert.deepEqual(events, [
    ["route", 2, [3], ZWaveDataRate["40k"]], ["set", true], ["report", true], ["clear", 2],
  ]);
  events.length = 0;
  assert.equal(await new PriorityRouteDemo().run(transport, "ping", false, "9.6k"), "Ping acknowledged");
  assert.deepEqual(events, [["route", 2, [], ZWaveDataRate["9k6"]], "ping", ["clear", 2]]);
});

test("an acknowledged unsupervised set updates the toggle without a state query", async () => {
  const states: boolean[] = [];
  const api = {
    async set() { return undefined; },
    async get() { assert.fail("Slide 7 must not send Binary Switch Get"); },
  };
  const transport = createPlugTransport({
    async setPriorityRoute() { return true; }, async removePriorityRoute() { return true; },
  }, {
    async ping() { return false; },
    commandClasses: { "Binary Switch": api },
  }, value => states.push(value));
  assert.equal(await transport.send("on"), "On acknowledged");
  assert.deepEqual(states, [true]);
  assert.equal(await transport.send("off"), "Off acknowledged");
  assert.deepEqual(states, [true, false]);
  await assert.rejects(transport.send("ping"), /did not acknowledge/);
  assert.deepEqual(states, [true, false]);
});

test("the toggle waits for the command to finish", async () => {
  let acknowledge!: () => void;
  const completion = new Promise<undefined>(resolve => { acknowledge = () => resolve(undefined); });
  const states: boolean[] = [];
  const transport = createPlugTransport({
    async setPriorityRoute() { return true; }, async removePriorityRoute() { return true; },
  }, {
    async ping() { return true; },
    commandClasses: { "Binary Switch": { set: () => completion } },
  }, value => states.push(value));
  const pending = transport.send("on");
  assert.deepEqual(states, []);
  acknowledge();
  assert.equal(await pending, "On acknowledged");
  assert.deepEqual(states, [true]);
});

test("a missing ACK leaves the toggle unchanged and still clears the route", async () => {
  const events: string[] = [];
  const transport = createPlugTransport({
    async setPriorityRoute() { events.push("route"); return true; },
    async removePriorityRoute() { events.push("clear"); return true; },
  }, {
    async ping() { return true; },
    commandClasses: { "Binary Switch": {
      async set() { events.push("set"); throw new Error("No ACK"); },
    } },
  }, () => assert.fail("A failed command must not update the toggle"));
  await assert.rejects(new PriorityRouteDemo().run(transport, "on", false, "100k"), /No ACK/);
  assert.deepEqual(events, ["route", "set", "clear"]);
});

test("failed supervision surfaces a command failure without a follow-up query", async () => {
  const api = {
    async set() { return { status: SupervisionStatus.Fail } as const; },
    async get() { assert.fail("Slide 7 must not send Binary Switch Get"); },
  };
  const controller = { async setPriorityRoute() { return true; }, async removePriorityRoute() { return true; } };
  const rejected = createPlugTransport(controller, { async ping() { return true; }, commandClasses: { "Binary Switch": api } },
    () => assert.fail("Failed supervision must not update the toggle"));
  await assert.rejects(rejected.send("on"), /Fail/);
});
