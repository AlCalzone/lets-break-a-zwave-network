import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const source = process.argv[2];
if (!source) throw new Error("Pass the extracted Claude Design directory.");
const html = await readFile(path.join(source, "Z-Wave Deck.dc.html"), "utf8");
const decode = (value) =>
  value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
const slides = [...html.matchAll(/<section class="slide\b[\s\S]*?<\/section>/g)].map(
  ([markup], index) => ({
    number: index + 1,
    title: decode(markup.match(/data-label="([^"]*)"/)?.[1] ?? `Slide ${index + 1}`),
    notes: decode(markup.match(/data-speaker-notes="([^"]*)"/)?.[1] ?? ""),
    html: markup.replaceAll('src="uploads/', 'src="/uploads/'),
  }),
);
if (slides.length !== 19) throw new Error(`Expected 19 slides, found ${slides.length}.`);
const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
if (!css) throw new Error("The export has no slide stylesheet.");
const systems = await readdir(path.join(source, "_ds"));
if (systems.length !== 1) throw new Error("Expected one design system.");
const industry = await readFile(path.join(source, "_ds", systems[0], "styles.css"), "utf8");
await mkdir("src/slides", { recursive: true });
await mkdir("src/styles", { recursive: true });
await mkdir("design", { recursive: true });
await mkdir("public", { recursive: true });
await writeFile("src/slides/authored.json", JSON.stringify(slides.slice(0, 14), null, 2) + "\n");
await writeFile("design/interaction-references.json", JSON.stringify(slides.slice(14), null, 2) + "\n");
await writeFile("src/styles/industry.css", industry.replace(/^@import[^\n]*\n/gm, ""));
await writeFile("src/styles/slides.css", css.replaceAll("deck-stage", ".deck-canvas"));
await cp(path.join(source, "uploads"), "public/uploads", { recursive: true });
console.log("Imported 14 slides and 5 design references.");
