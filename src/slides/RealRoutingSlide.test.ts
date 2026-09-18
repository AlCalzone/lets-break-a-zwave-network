import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DemoFrame } from "../demo/types";
import { ConnectionsContext } from "../presentation/ConnectionsContext";
import { mainNetworkNodes } from "../zwave/network";

const cssHook = registerHooks({
  load(url, context, nextLoad) {
    return url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : nextLoad(url, context);
  },
});
const { RealRoutingSlide } = await import("./RealRoutingSlide");
cssHook.deregister();

test("Direct mode displays the repeater lane and fallback routed frames", () => {
  const frame: DemoFrame = {
    id: "fallback", networkId: "main", exchangeId: 1, sequence: 1,
    timestampMs: 0, source: 1, target: 3, route: [1, 3, 2],
    kind: "ROUTED DATA", payload: Uint8Array.from([0x25, 0x01, 0xff]), speed: "100k",
  };
  const markup = renderToStaticMarkup(createElement(ConnectionsContext.Provider, {
    value: { ready: true, open() {} },
  }, createElement(RealRoutingSlide, {
    frames: [frame], nodes: mainNetworkNodes("main"), ready: true, busy: false,
    on: false, outcome: { kind: "idle", label: "" }, cleanupRequired: false,
    canClearRoute: true, onAction() {}, onClearRoute() {}, onClearCapture() {},
  })));
  assert.match(markup, /aria-pressed="true"[^>]*>Direct<\/button>/);
  const headers = [...markup.matchAll(/class="lane"[^>]*>(\d+) ·/g)].map(match => Number(match[1]));
  assert.deepEqual(headers, [1, 3, 2]);
  assert.match(markup, /data-frame-id="fallback"/);
});
