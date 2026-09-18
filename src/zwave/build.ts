import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import { ConfigManager } from "@zwave-js/config";

const require = createRequire(import.meta.url);
const configRoot = path.join(path.dirname(require.resolve("@zwave-js/config/package.json")), "config");
const prefix = "/zwave-config/";

export function zwaveBrowser(): Plugin {
  const files = new Map<string, Uint8Array>();
  let loaded: Promise<void> | undefined;
  function load() {
    return loaded ??= (async () => {
      // Generate the official index once on the build host
      await new ConfigManager().loadAll();
      async function collect(dir: string) {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const filename = path.join(dir, entry.name);
          if (entry.isDirectory()) await collect(filename);
          else if (entry.name.endsWith(".json")) {
            files.set(path.relative(configRoot, filename).replaceAll("\\", "/"), await readFile(filename));
          }
        }
      }
      await collect(configRoot);
    })();
  }
  return {
    name: "zwave-browser",
    async buildStart() { await load(); },
    resolveId(id) {
      if (id === "virtual:zwave-config") return "\0virtual:zwave-config";
    },
    async load(id) {
      if (id !== "\0virtual:zwave-config") return;
      await load();
      return `export default ${JSON.stringify(Object.fromEntries([...files].map(([name, data]) => [name, data.byteLength])))}`;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(prefix)) return next();
        await load();
        const data = files.get(decodeURIComponent(req.url.slice(prefix.length).split("?")[0]));
        if (!data) { res.statusCode = 404; res.end("Unknown Z-Wave configuration"); return; }
        res.setHeader("Content-Type", "application/json");
        res.end(data);
      });
    },
    generateBundle(_options, bundle) {
      for (const [name, data] of files) {
        this.emitFile({ type: "asset", fileName: `zwave-config/${name}`, source: data });
      }
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        for (const id of Object.keys(chunk.modules)) {
          if (id.includes("__vite-browser-external") || id.includes("@serialport/") ||
              /\/bindings\/(?:fs|log)\/node\./.test(id) ||
              /\/crypto\/primitives\/primitives\.node\./.test(id)) {
            this.error(`Node-only module reached the browser bundle: ${id}`);
          }
        }
      }
    },
  };
}
