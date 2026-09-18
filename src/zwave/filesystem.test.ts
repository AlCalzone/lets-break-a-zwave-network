import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { FileSystem } from "@zwave-js/shared/bindings";
import { createBrowserFileSystem } from "./filesystem";

test("configuration has real directory and stat semantics without network requests", async () => {
  let fetched = "";
  const fs = createBrowserFileSystem({} as FileSystem, {
    "manufacturers.json": 10,
    "devices/index.json": 20,
    "devices/0x0001/device.json": 30,
  }, (async url => { fetched = String(url); return new Response('{"ok":true}'); }) as typeof fetch);
  assert.deepEqual(await fs.readDir("/zwave-config"), ["manufacturers.json", "devices"]);
  assert.deepEqual(await fs.readDir("/zwave-config/devices"), ["index.json", "0x0001"]);
  assert.equal((await fs.stat("/zwave-config/devices")).isDirectory(), true);
  assert.equal((await fs.stat("/zwave-config/devices/index.json")).size, 20);
  assert.equal((await fs.stat("http:/localhost:5174/config/manufacturers.json")).size, 10);
  assert.equal((await fs.stat("https://localhost/config/devices/index.json")).size, 20);
  assert.equal(fetched, "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/zwave-config/manufacturers.json")), '{"ok":true}');
  assert.equal(fetched, "/zwave-config/manufacturers.json");
  await assert.rejects(fs.readFile("/zwave-config/missing.json"), /not found/);
  await assert.rejects(fs.writeFile("/zwave-config/manufacturers.json", new Uint8Array()), /read-only/);
});
