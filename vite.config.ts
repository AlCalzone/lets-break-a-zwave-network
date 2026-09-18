import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { zwaveBrowser } from "./src/zwave/build";

export default defineConfig({
  plugins: [react(), zwaveBrowser()],
  resolve: {
    alias: {
      "@zwave-js/core/bindings/fs/node": "@zwave-js/core/bindings/fs/stub",
      "@zwave-js/core/bindings/db/jsonl": "@zwave-js/core/bindings/db/stub",
      "@zwave-js/core/bindings/log/node": "@zwave-js/core/bindings/log/stub",
      "@zwave-js/serial/bindings/node": "@zwave-js/serial/bindings/stub",
      "zwave-js/experimental-rcp": new URL("./node_modules/zwave-js/build/esm/RCPHost.js", import.meta.url).pathname,
    },
  },
  optimizeDeps: {
    include: ["zwave-js", "zwave-js/experimental-rcp"],
    esbuildOptions: { keepNames: true },
  },
  esbuild: { keepNames: true },
  build: { target: "es2022" },
});
