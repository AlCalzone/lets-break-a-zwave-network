import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DemoFrame } from "../../demo/types";
import { appendDemoFrames, createBaselineFrames, createDemoNodes, createMockExchange, MAX_DEMO_FRAMES } from "../../demo/fixtures";
import { FrameLog } from "./FrameLog";
import { FrameChip, NodePath, RSSIIndicator, SpeedBadge } from "./FrameParts";
import { LaneView, laneCanvasHeight } from "./LaneView";
import { fitPayload, formatTime, frameLabel, MIN_PAYLOAD_FONT_SIZE, PAYLOAD_CHARACTER_WIDTH, prepareFrames } from "./frameData";
import { followNewestFrame } from "./useFrameScroll";

const onClear = () => {};

test("every Zniffer view keeps Clear rightmost in the header before and after clearing", () => {
  for (const frames of [createBaselineFrames(), []]) {
    const views = [
      createElement(LaneView, { frames, nodes: createDemoNodes(), onClear }),
      ...(["full", "compact", "hops"] as const).map(variant => createElement(FrameLog, { frames, variant, onClear })),
    ];
    for (const view of views) {
      const markup = renderToStaticMarkup(view);
      assert.match(markup, /class="zn-bar"><span>[^<]+<\/span><div class="zn-actions">/);
      assert.match(markup, /<button type="button" class="zn-clear">Clear<\/button><\/div><\/div>/);
      assert.equal((markup.match(/>Clear<\/button>/g) ?? []).length, 1);
      assert.equal((markup.match(/data-frame-id=/g) ?? []).length, frames.length);
      assert.doesNotMatch(markup, /No captured frames|Use a node control|zn-empty/);
    }
  }
  const css = readFileSync(new URL("./zniffer.css", import.meta.url), "utf8");
  assert.match(css, /\.zn-live \.zn-bar \{[^}]*justify-content: flex-start;/);
  assert.match(css, /\.zn-actions \{[^}]*display: flex;[^}]*margin-left: auto;/);
  assert.match(css, /\.zn-clear:focus-visible \{/);
});

test("frame preparation orders every retained frame without changing exchange times", () => {
  const frames = createBaselineFrames();
  const rows = prepareFrames([...frames].reverse());
  assert.deepEqual(rows.map(({ elapsedMs }) => elapsedMs), [0, 4.1, 9.8, 13.2]);
  assert.deepEqual(rows.map(({ path }) => path), Array.from({ length: 4 }, () => [1, 2, 3]));
  assert.equal(rows.at(-1)?.frame.id, frames.at(-1)?.id);
});

test("trace timestamps display rounded whole milliseconds without changing raw timing", () => {
  for (const [value, expected] of [
    [0, "0"], [0.49, "0"], [0.5, "1"], [4.1, "4"], [9.8, "10"], [13.2, "13"],
    [Number.NaN, "—"], [Infinity, "—"], [-Infinity, "—"],
  ] as const) {
    assert.equal(formatTime(value), expected);
  }
  const frames = createBaselineFrames();
  const expectedTimes = ["0", "4", "10", "13"];
  const lane = renderToStaticMarkup(createElement(LaneView, { frames, nodes: createDemoNodes(), onClear }));
  assert.deepEqual([...lane.matchAll(/class="tm"[^>]*>([^<]+)<\/text>/g)].map(match => match[1]), expectedTimes);
  for (const time of expectedTimes) {
    assert.ok(lane.includes(`, ${time} ms"`));
    assert.ok(lane.includes(`, ${time} ms</title>`));
  }
  for (const variant of ["full", "compact", "hops"] as const) {
    const log = renderToStaticMarkup(createElement(FrameLog, { frames, variant, onClear }));
    const displayedTimes = [...log.matchAll(/class="zn-t">([^<]+)<\/span>/g)].map(match => match[1]);
    assert.deepEqual(displayedTimes, variant === "full" ? expectedTimes : []);
  }
  assert.deepEqual(frames.map(frame => frame.timestampMs), [0, 4.1, 9.8, 13.2]);
  assert.deepEqual(prepareFrames(frames).map(row => row.elapsedMs), [0, 4.1, 9.8, 13.2]);
});

test("exchange-relative timestamps survive truncated history", () => {
  const base = createBaselineFrames()[0];
  const frames = [
    { ...base, timestampMs: 400 },
    { ...base, id: "other:1", networkId: "other", sequence: 2, timestampMs: 900 },
  ];
  assert.deepEqual(prepareFrames(frames).map(({ elapsedMs }) => elapsedMs), [400, 900]);
});

test("path preserves node order and highlights the actual routed hop", () => {
  const frames = createBaselineFrames();
  const repeated = renderToStaticMarkup(createElement(NodePath, { frame: frames[1] }));
  assert.match(repeated, /Node 2 to node 3/);
  assert.match(repeated, /zn-nd idle[^>]*>1/);
  assert.match(repeated, /zn-nd tx[^>]*>2/);
  assert.match(repeated, /zn-nd rx[^>]*>3/);
  const ack = renderToStaticMarkup(createElement(NodePath, { frame: frames[2] }));
  assert.match(ack, /Node 3 to node 2/);
  assert.match(ack, /←/);
  assert.ok(ack.indexOf(">1<") < ack.indexOf(">2<"));
  assert.ok(ack.indexOf(">2<") < ack.indexOf(">3<"));
});

test("reverse data uses observed endpoints for direction", () => {
  const frame = { ...createBaselineFrames()[0], source: 3, target: 2 };
  const markup = renderToStaticMarkup(createElement(NodePath, { frame }));
  assert.match(markup, /Node 3 to node 2/);
  assert.match(markup, /←/);
  assert.match(markup, /zn-nd tx[^>]*>3/);
});

test("missing measurements use an em dash", () => {
  const frame: DemoFrame = { ...createBaselineFrames()[0], channel: undefined, rssi: undefined };
  const markup = renderToStaticMarkup(createElement(FrameLog, { frames: [frame], onClear }));
  assert.match(markup, /RSSI unavailable">—/);
  assert.match(markup, /zn-ch">—/);
  assert.match(renderToStaticMarkup(createElement(SpeedBadge, {})), />—</);
  assert.match(renderToStaticMarkup(createElement(RSSIIndicator, { rssi: Number.NaN })), />—</);
  assert.match(renderToStaticMarkup(createElement(RSSIIndicator, { rssi: 0 })), /RSSI 0 dBm/);
});

test("lane toolbar shows a speed legend using the frame swatch colors", () => {
  for (const frames of [createBaselineFrames(), []]) {
    const markup = renderToStaticMarkup(createElement(LaneView, { frames, nodes: createDemoNodes(), onClear }));
    const toolbar = markup.slice(markup.indexOf('class="zn-bar"'), markup.indexOf('class="zn-lane-header"') > 0
      ? markup.indexOf('class="zn-lane-header"') : markup.indexOf('class="zn-empty"'));
    assert.match(toolbar, /aria-label="Frame speed legend"/);
    assert.match(toolbar, /class="zn-actions"><div class="zn-speed-legend"/);
    assert.match(toolbar, /LR<\/span><\/div><button type="button" class="zn-clear">Clear<\/button>/);
    for (const [speed, label] of [["9", "9.6 kbps"], ["40", "40 kbps"], ["100", "100 kbps"], ["lr", "LR"]]) {
      assert.ok(toolbar.includes(`class="sw-${speed}"`));
      assert.ok(toolbar.includes(label));
    }
    assert.doesNotMatch(toolbar, /class="meta"|exchange/);
  }
});

test("live lanes show the configured nodes before any capture arrives", () => {
  const markup = renderToStaticMarkup(createElement(LaneView, {
    onClear,
    frames: [], nodes: createDemoNodes().slice(0, 3), fixedNodes: true,
    emptyMessage: "Waiting for the main network.",
  }));
  assert.match(markup, /001 · CONTROLLER/);
  assert.match(markup, /002 · PLUG/);
  assert.match(markup, /003 · REMOTE/);
  assert.match(markup, /Waiting for the main network\./);
  assert.doesNotMatch(markup, /data-frame-id=/);
});

test("fixed lanes only render hops between supplied network-scoped endpoints", () => {
  const baseline = createBaselineFrames();
  const nodes = createDemoNodes().slice(0, 2);
  const frames = [
    ...baseline,
    { ...baseline[0], id: "other:1", networkId: "other" },
    { ...baseline[0], id: "unknown-source", source: 9 },
    { ...baseline[0], id: "unknown-target", target: 9 },
  ];
  const original = structuredClone(frames);
  for (const supplied of [nodes, [...nodes, { ...nodes[0], id: "other:1", networkId: "other" }]]) {
    const markup = renderToStaticMarkup(createElement(LaneView, { frames, nodes: supplied, onClear, fixedNodes: true }));
    const displayed = [...markup.matchAll(/data-frame-id="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(displayed, [baseline[0].id, baseline[3].id]);
    assert.equal((markup.match(/class="life"/g) ?? []).length, supplied.length);
    assert.doesNotMatch(markup, /003 ·|009 ·/);
  }
  const empty = renderToStaticMarkup(createElement(LaneView, { frames, nodes: [], onClear, fixedNodes: true }));
  assert.doesNotMatch(empty, /data-frame-id=|class="life"/);
  assert.deepEqual(frames, original);
});

test("switching fixed nodes restores repeater hops and preserves supplied lane order", () => {
  const frames = createBaselineFrames();
  const original = structuredClone(frames);
  const nodes = createDemoNodes();
  const routedNodes = [nodes[0], nodes[2], nodes[1]];
  const directNodes = routedNodes.filter(node => node.nodeId !== 3);
  for (const supplied of [routedNodes, directNodes, routedNodes]) {
    const markup = renderToStaticMarkup(createElement(LaneView, { frames, nodes: supplied, onClear, fixedNodes: true }));
    const headers = [...markup.matchAll(/class="lane"[^>]*>(\d+) ·/g)].map(match => Number(match[1]));
    assert.deepEqual(headers, supplied.map(node => node.nodeId));
    assert.equal((markup.match(/data-frame-id=/g) ?? []).length, supplied === routedNodes ? 4 : 2);
  }
  assert.deepEqual(frames, original);
});

test("non-fixed mock lanes still infer every observed path node", () => {
  const frames = createBaselineFrames();
  const markup = renderToStaticMarkup(createElement(LaneView, {
    frames, nodes: createDemoNodes().filter(node => node.nodeId !== 3), onClear,
  }));
  assert.match(markup, /003 · —/);
  assert.equal((markup.match(/class="life"/g) ?? []).length, 3);
  assert.equal((markup.match(/data-frame-id=/g) ?? []).length, frames.length);
});

test("lane lifelines fill the viewport without stretching captured rows", () => {
  assert.equal(laneCanvasHeight(0, 1020, { width: 1020, height: 500 }), 500);
  assert.equal(laneCanvasHeight(4, 1020, { width: 1530, height: 750 }), 500);
  assert.equal(laneCanvasHeight(4, 1020, { width: 800, height: 500 }), 500);
  assert.equal(laneCanvasHeight(20, 1020, { width: 1020, height: 500 }), 1136);
});
test("all frame log variants render the entire retained history", () => {
  const frames = appendDemoFrames([], Array.from({ length: 80 }, (_, index) => ({
    ...createBaselineFrames()[0], id: `frame-${index}`, sequence: index + 1,
  })));
  for (const variant of ["full", "compact", "hops"] as const) {
    const markup = renderToStaticMarkup(createElement(FrameLog, { frames, variant, onClear }));
    assert.equal((markup.match(/data-frame-id=/g) ?? []).length, MAX_DEMO_FRAMES);
    assert.match(markup, /data-frame-id="frame-16"/);
    assert.match(markup, /data-frame-id="frame-79"/);
    assert.doesNotMatch(markup, /data-frame-id="frame-0"/);
    assert.match(markup, /64 frames/);
    assert.match(markup, /data-own-arrow-keys/);
    assert.equal(markup.includes("Time · ms"), variant === "full");
    assert.equal(markup.includes('role="columnheader">RSSI'), variant !== "hops");
  }
});

test("logs keep payloads next to the route with speed and measurements on the right", () => {
  for (const variant of ["full", "compact", "hops"] as const) {
    const markup = renderToStaticMarkup(createElement(FrameLog, { frames: createBaselineFrames().slice(0, 1), variant, onClear }));
    const headers = [...markup.matchAll(/role="columnheader">([^<]+)<\/span>/g)].map((match) => match[1]);
    const cells = [...markup.matchAll(/role="cell" class="([^"]+)"/g)].map((match) => match[1]);
    if (variant === "hops") {
      assert.deepEqual(headers, ["#", "Path · direction", "Frame", "Speed"]);
      assert.deepEqual(cells, ["zn-seq", "zn-path-cell", "zn-frame-cell", "zn-speed-cell"]);
    } else {
      assert.deepEqual(headers, ["#", ...(variant === "full" ? ["Time · ms"] : []), "Path · direction", "Frame", "Speed", "RSSI", "Ch"]);
      assert.deepEqual(cells, ["zn-seq", ...(variant === "full" ? ["zn-t"] : []), "zn-path-cell", "zn-frame-cell", "zn-speed-cell", "zn-rssi-cell", "zn-ch"]);
    }
  }
});

test("payload columns are left-aligned and use remaining width before right-hand metadata", () => {
  const css = readFileSync(new URL("./zniffer.css", import.meta.url), "utf8");
  for (const variant of ["full", "compact"]) {
    const rules = [...css.matchAll(new RegExp(`\\.zn-live-${variant} \\.zn-live-cols \\{ grid-template-columns: ([^;]+);`, "g"))];
    assert.equal(rules.length, 2);
    for (const [, columns] of rules) {
      assert.match(columns, /(?:200|170)px minmax\(0, 1fr\) \d+px \d+px \d+px$/);
      assert.equal((columns.match(/1fr/g) ?? []).length, 1);
    }
  }
  assert.match(css, /\.zn-live-hops \.zn-live-cols \{ grid-template-columns: 46px minmax\(200px, 1fr\) 180px 78px;/);
  assert.match(css, /\.zn-live \.zn-frame-cell \{ text-align: left; justify-self: stretch;/);
  assert.match(css, /\.zn-live \.zn-payload-chip \{[^}]*text-align: left;/);
});

test("route columns contain three nodes and two arrows at both breakpoints", () => {
  const css = readFileSync(new URL("./zniffer.css", import.meta.url), "utf8");
  const [regular, narrow] = css.split("@container");
  for (const [rules, expectedWidth] of [[regular, 194], [narrow, 165]] as const) {
    const nodeWidth = Number(rules.match(/\.zn-live \.zn-nd \{[^}]*width: (\d+)px/)?.[1]);
    const arrowWidth = Number(rules.match(/\.zn-live \.zn-hop \{[^}]*flex: 0 0 (\d+)px/)?.[1]);
    const gap = Number(rules.match(/\.zn-live \.zn-chain \{ gap: (\d+)px/)?.[1]);
    const threeNodes = 3 * nodeWidth + 2 * arrowWidth + 4 * gap;
    const fourNodes = 4 * nodeWidth + 3 * arrowWidth + 6 * gap;
    assert.equal(threeNodes, expectedWidth);
    for (const variant of ["full", "compact"]) {
      const columns = rules.match(new RegExp(`\\.zn-live-${variant} \\.zn-live-cols \\{ grid-template-columns: ([^;]+);`))?.[1];
      assert.ok(columns);
      const routeWidth = Number(columns.match(/(\d+)px minmax\(0, 1fr\)/)?.[1]);
      assert.ok(threeNodes <= routeWidth);
      assert.ok(fourNodes > routeWidth);
    }
  }
  assert.match(css, /\.zn-live \.zn-nd \{ box-sizing: border-box;/);
  assert.match(css, /\.zn-live \.zn-path-cell \{ overflow-x: auto;/);
  const route = renderToStaticMarkup(createElement(NodePath, { frame: createBaselineFrames()[0] }));
  assert.equal((route.match(/class="zn-nd /g) ?? []).length, 3);
  assert.equal((route.match(/class="zn-hop/g) ?? []).length, 2);
});

test("Zniffer keeps empty capture free of commentary and invented frames", () => {
  for (const fixedNodes of [false, true]) {
    const markup = renderToStaticMarkup(createElement(LaneView, { frames: [], nodes: createDemoNodes(), fixedNodes, onClear }));
    assert.match(markup, /aria-label="Zniffer"/);
    assert.match(markup, /class="zn-bar"><span>Zniffer<\/span>/);
    assert.doesNotMatch(markup, /Lane view|No captured frames|Waiting for|zn-capture-waiting|zn-empty/);
    assert.doesNotMatch(markup, /data-frame-id=/);
  }
});

test("lane views use unique markers and actual frame endpoints", () => {
  const frames = createBaselineFrames();
  const markup = renderToStaticMarkup(createElement(Fragment, null,
    createElement(LaneView, { frames, nodes: createDemoNodes(), onClear }),
    createElement(LaneView, { frames, nodes: createDemoNodes(), onClear }),
  ));
  const ids = [...markup.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  const definitionIds = ids.filter((id) => /-(title|normal|error)$/.test(id));
  assert.equal(new Set(definitionIds).size, definitionIds.length);
  assert.match(markup, /node 2 to node 3, 20 01 FF/);
  assert.match(markup, /node 3 to node 2, ROUTED ACK/);
  assert.match(markup, /class="arw ack" d="M852 148H538"/);
  assert.match(markup, /class="chip f-100"/);
  assert.match(markup, /class="sw-40"/);
});

test("latest error and retries remain visible", () => {
  const frames = createMockExchange(createDemoNodes()[0], "basic-set", "no-ack", 2, 1).frames;
  const markup = renderToStaticMarkup(createElement(LaneView, { frames, nodes: createDemoNodes(), onClear }));
  assert.equal((markup.match(/data-frame-id=/g) ?? []).length, frames.length);
  assert.match(markup, /ROUTED ERROR/);
  assert.match(markup, /zn-lane-error/);
  assert.match(markup, /retry/);
  assert.match(renderToStaticMarkup(createElement(FrameChip, { frame: frames.at(-1)! })), /is-err/);
});

test("all views format binary payloads as padded uppercase hex", () => {
  const frame = { ...createBaselineFrames()[0], payload: Uint8Array.from([0x00, 0x0a, 0x80, 0xff]) };
  assert.equal(frameLabel(frame), "00 0A 80 FF");
  assert.equal(frameLabel({ ...frame, payload: new Uint8Array() }), "—");
  for (const kind of ["DATA", "ROUTED DATA"] as const) {
    const frames = [{ ...frame, kind }];
    const markups = [
      ...(["full", "compact", "hops"] as const).map((variant) =>
        renderToStaticMarkup(createElement(FrameLog, { frames, variant, onClear }))),
      renderToStaticMarkup(createElement(LaneView, { frames, nodes: createDemoNodes(), onClear })),
    ];
    for (const markup of markups) {
      assert.match(markup, /00 0A 80 FF/);
      assert.doesNotMatch(markup, /DATA/);
    }
  }
});

test("payload fitting shrinks medium payloads before abbreviating longer ones", () => {
  const cases = [
    { width: 220, maximumFontSize: 23, short: 5, medium: 6, long: 7 },
    { width: 162, maximumFontSize: 21, short: 4, medium: 5, long: 6 },
    { width: 140, maximumFontSize: 21, short: 3, medium: 4, long: 5 },
    { width: 124, maximumFontSize: 19, short: 3, medium: 4, long: 5 },
  ];
  const hexFor = (length: number) => frameLabel({
    kind: "DATA", payload: Uint8Array.from({ length }, (_, index) => index),
  });
  for (const { width, maximumFontSize, short, medium, long } of cases) {
    const small = fitPayload(hexFor(short), width, maximumFontSize);
    assert.equal(small.text, hexFor(short));
    assert.equal(small.fontSize, maximumFontSize);
    assert.equal(small.truncated, false);
    const reduced = fitPayload(hexFor(medium), width, maximumFontSize);
    assert.equal(reduced.text, hexFor(medium));
    assert.ok(reduced.fontSize < maximumFontSize);
    assert.ok(reduced.fontSize >= MIN_PAYLOAD_FONT_SIZE);
    assert.equal(reduced.truncated, false);
    const abbreviated = fitPayload(hexFor(long), width, maximumFontSize);
    assert.equal(abbreviated.fontSize, MIN_PAYLOAD_FONT_SIZE);
    assert.equal(abbreviated.truncated, true);
    assert.match(abbreviated.text, /^(?:[0-9A-F]{2} )+\.\.\.$/);
  }
});

test("payload fitting stays within its width and truncates only at byte boundaries", () => {
  for (const width of [110, 120, 124, 140, 162, 220]) {
    for (let length = 1; length <= 255; length++) {
      const hex = frameLabel({ kind: "DATA", payload: Uint8Array.from({ length }, (_, index) => index) });
      const fitted = fitPayload(hex, width, 23);
      assert.ok(fitted.text.length * fitted.fontSize * PAYLOAD_CHARACTER_WIDTH <= width);
      assert.ok(fitted.fontSize >= 18 && fitted.fontSize <= 23);
      assert.match(fitted.text, /^[0-9A-F]{2}(?: [0-9A-F]{2})*(?: \.\.\.)?$/);
      assert.ok(hex.startsWith(fitted.text.replace(/ \.\.\.$/, "")));
    }
  }
  const retry = fitPayload("00 ".repeat(254) + "FF", 220, 23, " · retry");
  assert.match(retry.text, /^(?:[0-9A-F]{2} )+\.\.\. · retry$/);
  assert.ok(retry.text.length * retry.fontSize * PAYLOAD_CHARACTER_WIDTH <= 220);
});

test("long payloads keep lane geometry bounded and retain full accessible hex", () => {
  const frame = { ...createBaselineFrames()[0], payload: Uint8Array.from({ length: 255 }, (_, index) => index) };
  const hex = frameLabel(frame);
  const lane = renderToStaticMarkup(createElement(LaneView, { frames: [frame], nodes: createDemoNodes(), onClear }));
  assert.match(lane, /viewBox="0 0 1020 48"/);
  assert.match(lane, /viewBox="0 0 1020 240"/);
  assert.match(lane, /class="chip f-100"[^>]*width="250"/);
  assert.match(lane, /class="cl zn-payload on" style="font-size:18px"[^>]*>00 01 02 03 04 \.\.\.<\/text>/);
  assert.ok(lane.includes(`aria-label="#1: node 1 to node 2, ${hex}, 100k, 0 ms"`));
  assert.ok(lane.includes(`<title>#1: node 1 to node 2, ${hex}, 100k, 0 ms</title>`));
  assert.doesNotMatch(lane, /textLength/);
  for (const variant of ["full", "compact", "hops"] as const) {
    const log = renderToStaticMarkup(createElement(FrameLog, { frames: [frame], variant, onClear }));
    assert.ok(log.includes(`aria-label="${hex}" title="${hex}"`));
    assert.match(log, /class="zn-payload" style="font-size:18px"[^>]*>00 01 \.\.\.<\/span>/);
    assert.equal((log.match(/data-frame-id=/g) ?? []).length, 1);
  }
});

test("ACK labels stay complete and long retry payloads retain retry status", () => {
  for (const kind of ["ACK", "ROUTED ACK", "ROUTED ERROR"] as const) {
    const frame = { ...createBaselineFrames()[0], kind, payload: new Uint8Array() };
    const chip = renderToStaticMarkup(createElement(FrameChip, { frame }));
    assert.ok(chip.includes(`>${kind}</span>`));
    assert.doesNotMatch(chip, /zn-payload/);
  }
  const frame = { ...createBaselineFrames()[0], retry: true, payload: new Uint8Array(255) };
  const chip = renderToStaticMarkup(createElement(FrameChip, { frame }));
  assert.match(chip, /class="zn-retry"[^>]*> · retry<\/span>/);
  assert.ok(chip.includes(`title="${frameLabel(frame)} · retry"`));
});

test("lane history grows vertically to include every retained frame", () => {
  const frames = Array.from({ length: MAX_DEMO_FRAMES }, (_, index) => ({
    ...createBaselineFrames()[0], id: `frame-${index}`, sequence: index + 1,
  }));
  const markup = renderToStaticMarkup(createElement(LaneView, { frames, nodes: createDemoNodes(), onClear }));
  assert.equal((markup.match(/data-frame-id=/g) ?? []).length, MAX_DEMO_FRAMES);
  assert.match(markup, /data-frame-id="frame-0"/);
  assert.match(markup, /data-frame-id="frame-63"/);
  assert.match(markup, /viewBox="0 0 1020 3600"/);
  assert.match(markup, /data-own-arrow-keys/);
});

test("lane node headers sit outside the scrolling history with matching lane coordinates", () => {
  const frames = Array.from({ length: MAX_DEMO_FRAMES }, (_, index) => ({
    ...createBaselineFrames()[0], id: `frame-${index}`, sequence: index + 1,
  }));
  for (const history of [frames.slice(0, 4), frames]) {
    const markup = renderToStaticMarkup(createElement(LaneView, { frames: history, nodes: createDemoNodes(), onClear }));
    const header = markup.match(/<div class="zn-lane-header">([\s\S]*?)<\/div><div class="zn-fig"/)?.[1];
    const body = markup.slice(markup.indexOf('<div class="zn-fig"'));
    assert.ok(header);
    assert.match(header, /viewBox="0 0 1020 48"/);
    assert.match(header, /class="lane" x="180" y="32"/);
    assert.match(header, />001 · CONTROLLER<\/text>/);
    assert.match(header, />002 · PLUG<\/text>/);
    assert.match(header, />003 · REMOTE<\/text>/);
    assert.doesNotMatch(header, /class="lane-sub"|>NODE /);
    assert.match(header, />MS</);
    assert.doesNotMatch(header, /data-frame-id=/);
    assert.doesNotMatch(body, />NODE |class="lane-sub"|>MS</);
    assert.equal((body.match(/data-frame-id=/g) ?? []).length, history.length);
    const headerPositions = [...header.matchAll(/class="lane" x="([^"]+)"/g)].map((match) => match[1]);
    const lanePositions = [...body.matchAll(/class="life" d="M([^ ]+) 0V/g)].map((match) => match[1]);
    assert.deepEqual(headerPositions, lanePositions);
    assert.deepEqual(headerPositions, ["180", "520", "860"]);
    assert.match(header, /style="min-width:1020px"/);
    assert.match(body, /style="min-width:1020px"/);
    assert.match(markup, /class="zn-bar"><span>Zniffer<\/span>/);
  }
});

test("identical exchange and node IDs stay separate across networks", () => {
  const frame = createBaselineFrames()[0];
  const other = { ...frame, id: "other:1", networkId: "other", route: [1, 7], target: 7 };
  const rows = prepareFrames([frame, other]);
  assert.deepEqual(rows.map(({ path }) => path), [[1, 2, 3], [1, 7]]);
  const markup = renderToStaticMarkup(createElement(LaneView, {
    onClear,
    frames: [frame, other],
    nodes: [...createDemoNodes(), { ...createDemoNodes()[0], id: "other:1", networkId: "other", label: "Other controller" }],
  }));
  assert.match(markup, /OTHER CONTROLLER/);
  assert.equal((markup.match(/>001 · /g) ?? []).length, 2);
});

test("scroll follows frame updates, slide entry and resizing without locking manual scrolling", () => {
  const saved = ["MutationObserver", "ResizeObserver"].map((name) =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const callbacks: (() => void)[] = [];
  const observations: unknown[][] = [];
  let disconnects = 0;
  class Observer {
    constructor(callback: () => void) { callbacks.push(callback); }
    observe(...args: unknown[]) { observations.push(args); }
    disconnect() { disconnects++; }
  }
  Object.assign(globalThis, { MutationObserver: Observer, ResizeObserver: Observer });
  try {
    let active = false;
    const slide = { hasAttribute: (name: string) => name === "data-deck-active" && active };
    const element = { closest: () => slide, scrollTop: 0, scrollHeight: 500 };
    let stop = followNewestFrame(element as unknown as HTMLElement);
    assert.equal(element.scrollTop, 0);
    assert.deepEqual(observations[0], [slide, { attributes: true, attributeFilter: ["data-deck-active"] }]);
    active = true;
    callbacks[0]();
    assert.equal(element.scrollTop, 500);
    element.scrollTop = 100;
    assert.equal(element.scrollTop, 100);
    element.scrollHeight = 600;
    callbacks[1]();
    assert.equal(element.scrollTop, 600);
    stop();
    element.scrollHeight = 700;
    stop = followNewestFrame(element as unknown as HTMLElement);
    assert.equal(element.scrollTop, 700);
    active = false;
    element.scrollTop = 100;
    callbacks[2]();
    assert.equal(element.scrollTop, 100);
    active = true;
    callbacks[2]();
    assert.equal(element.scrollTop, 700);
    stop();
    assert.equal(disconnects, 4);
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
