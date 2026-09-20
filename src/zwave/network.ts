import type { DemoNode } from "../demo/types";

export const MAIN_CONTROLLER_NODE_ID = 1;
export const PLUG_NODE_ID = 2;
export const REPEATER_NODE_ID = 3;
export const FAKE_REPEATER_NODE_ID = 4;
export const SECOND_FAKE_REPEATER_NODE_ID = 5;
export const WALL_CONTROLLER_NODE_ID = 256;

export function mainNetworkNodes(networkId: string): DemoNode[] {
  return [
    { nodeId: MAIN_CONTROLLER_NODE_ID, label: "Controller", role: "Controller" },
    { nodeId: REPEATER_NODE_ID, label: "Dimmer", role: "Switch Multilevel" },
    { nodeId: PLUG_NODE_ID, label: "Plug", role: "Switch Binary" },
  ].map(node => ({
    ...node,
    id: `${networkId}:${node.nodeId}`,
    networkId,
    outcome: { kind: "idle", label: "Live device" },
  }));
}

export function mainNetworkNodesWithLongRange(networkId: string): DemoNode[] {
  return [
    ...mainNetworkNodes(networkId),
    {
      id: `${networkId}:${WALL_CONTROLLER_NODE_ID}`,
      networkId,
      nodeId: WALL_CONTROLLER_NODE_ID,
      label: "LR button",
      role: "Long Range",
      outcome: { kind: "idle" as const, label: "Live device" },
    },
  ];
}
