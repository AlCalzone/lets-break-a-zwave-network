import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectionsContext, ConnectionsLink } from "./ConnectionsContext";
import authoredSlides from "../slides/authored.json";
import { SlideFrame } from "./SlideFrame";

test("every interactive slide header links to connections with setup status", () => {
  for (const ready of [false, true]) {
    const markup = renderToStaticMarkup(createElement(ConnectionsContext.Provider, {
      value: { ready, open() {} },
    }, createElement(SlideFrame, { title: "Demo", children: null })));
    assert.match(markup, /class="connections-link header-connections"/);
    assert.match(markup, new RegExp(`data-ready="${ready}"`));
    assert.match(markup, /aria-label="Open connections" aria-haspopup="dialog"/);
    assert.match(markup, /<svg /);
    assert.ok(markup.includes(`title="Connections · ${ready ? "Ready" : "Not ready"}"`));
    assert.doesNotMatch(markup, /<span/);
    assert.doesNotMatch(markup, /Interactive demo/);
  }
});

test("the title slide uses an accessible icon-only connection link and three title lines", () => {
  const markup = renderToStaticMarkup(createElement(ConnectionsContext.Provider, {
    value: { ready: false, open() {} },
  }, createElement(ConnectionsLink, { placement: "title" })));
  assert.match(markup, /aria-label="Open connections"/);
  assert.match(markup, /class="connections-link title-connections"/);
  assert.match(markup, /<svg /);
  assert.doesNotMatch(markup, /<span/);
  assert.match(authoredSlides[0].html, /Let’s break<br>a Z-Wave<br>network/);
});
