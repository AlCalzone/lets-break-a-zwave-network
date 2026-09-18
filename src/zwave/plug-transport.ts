import { SupervisionStatus, ZWaveDataRate, type SupervisionResult } from "@zwave-js/core";
import { PLUG_NODE_ID } from "./network";
import type { DemoSpeed, RouteTransport } from "./priority-route";

interface Controller {
  setPriorityRoute(nodeId: number, repeaters: number[], speed: ZWaveDataRate): Promise<boolean>;
  removePriorityRoute(nodeId: number): Promise<boolean>;
}

interface Plug {
  ping(): Promise<boolean>;
  commandClasses: {
    "Binary Switch": {
      set(value: boolean): Promise<SupervisionResult | undefined>;
    };
  };
}

const rates: Record<DemoSpeed, ZWaveDataRate> = {
  "9.6k": ZWaveDataRate["9k6"], "40k": ZWaveDataRate["40k"], "100k": ZWaveDataRate["100k"],
};

export function createPlugTransport(controller: Controller, node: Plug, onExecuted: (value: boolean) => void): RouteTransport {
  return {
    setRoute: (repeaters, speed) => repeaters === undefined
      ? controller.removePriorityRoute(PLUG_NODE_ID)
      : controller.setPriorityRoute(PLUG_NODE_ID, repeaters, rates[speed ?? "100k"]),
    send: async action => {
      if (action === "ping") {
        if (!await node.ping()) throw new Error("Node 002 did not acknowledge the ping.");
        return "Ping acknowledged";
      }
      const api = node.commandClasses["Binary Switch"];
      const target = action === "on";
      const result = await api.set(target);
      if (result && result.status !== SupervisionStatus.Success) {
        throw new Error(`Switch command was not confirmed: ${SupervisionStatus[result.status]}.`);
      }
      onExecuted(target);
      return `${target ? "On" : "Off"} ${result ? "confirmed" : "acknowledged"}`;
    },
  };
}
