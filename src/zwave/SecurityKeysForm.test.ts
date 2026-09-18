import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SecurityKeysForm } from "./SecurityKeysForm";

function render(configured: string[], disabled = false) {
  return renderToStaticMarkup(createElement(SecurityKeysForm, {
    configured, disabled, onApply() {},
  }));
}

test("empty key fields cannot be saved", () => {
  const markup = render([]);
  assert.match(markup, /<summary>Network security keys<\/summary>/);
  assert.match(markup, /<button type="submit" disabled="">Save keys<\/button>/);
  assert.doesNotMatch(markup, /Clear saved keys/);
});

test("configured keys have an explicit clear action", () => {
  const markup = render(["S0_Legacy"]);
  assert.match(markup, /Configured: S0_Legacy/);
  assert.match(markup, /<button type="submit" disabled="">Replace keys<\/button>/);
  assert.match(markup, /<button type="button">Clear saved keys<\/button>/);
});

test("connected hardware prevents editing and clearing keys", () => {
  const markup = render(["S0_Legacy"], true);
  assert.match(markup, /Disconnect controller and Zniffer to edit\./);
  assert.match(markup, /<button type="button" disabled="">Clear saved keys<\/button>/);
  assert.equal((markup.match(/<input[^>]* disabled=""/g) ?? []).length, 6);
});
