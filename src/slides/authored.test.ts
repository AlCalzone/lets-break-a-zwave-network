import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import slides from "./authored.json";

test("only the fourteen authored slides are in the imported deck", () => {
  assert.equal(slides.length, 14);
  assert.deepEqual(slides.map((slide) => slide.number), Array.from({ length: 14 }, (_, i) => i + 1));
  assert.equal(slides[13].title, "Let’s break the network");
  assert.ok(slides.every((slide) => slide.notes.length > 0));
});

test("slide images resolve to bundled local files", async () => {
  for (const slide of slides) {
    assert.doesNotMatch(slide.html, /<script\b/i);
    for (const [, source] of slide.html.matchAll(/<img[^>]+src="([^"]+)"/g)) {
      assert.ok(source.startsWith("/uploads/"));
      await access(new URL(`../../public${source}`, import.meta.url));
    }
  }
});

test("the imported styles do not fetch remote fonts", async () => {
  for (const name of ["industry", "slides"]) {
    const css = await readFile(new URL(`../styles/${name}.css`, import.meta.url), "utf8");
    assert.doesNotMatch(css, /@import\s+url\(['"]?https?:/);
  }
});
