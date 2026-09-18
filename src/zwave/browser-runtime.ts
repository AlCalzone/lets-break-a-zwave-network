import "./polyfills";
import { fs as cache } from "@zwave-js/bindings-browser/fs";
import { log } from "@zwave-js/core/bindings/log/browser";
import { Driver, Zniffer } from "zwave-js";
// Z-Wave JS 15.29.0 omits RCPHost from its browser export map
import { RCPHost } from "zwave-js/experimental-rcp";
import files from "virtual:zwave-config";
import { createBrowserFileSystem } from "./filesystem";
import { database } from "./database";
import { createBrowserSerialFactory } from "./serial";
import type { HardwareSecurityOptions } from "./hardware";
import { requiredRegion, requiredZnifferChannels, requiredZnifferRegion } from "./radio-config";

const fs = createBrowserFileSystem(cache, files);
const host = { fs, db: database, log, serial: {} };

export function createMain(port: SerialPort, cacheDir: string, security: HardwareSecurityOptions = {}) {
  return new Driver(createBrowserSerialFactory(port), {
    host,
    ...security,
    storage: { cacheDir },
    rf: { region: requiredRegion, preferLRRegion: false },
  });
}

export function createZniffer(port: SerialPort, security: HardwareSecurityOptions = {}) {
  return new Zniffer(createBrowserSerialFactory(port), {
    host,
    ...security,
    maxCapturedFrames: 10_000,
    convertRSSI: false,
    defaultFrequency: requiredZnifferRegion,
    defaultLRChannelConfig: requiredZnifferChannels,
  });
}

export function createRcp(port: SerialPort, _cacheDir: string) {
  // RCPHost 15.29.0 rejects factories in its constructor despite accepting them in its types
  const selectedPort = "web-serial:selected-rcp";
  return new RCPHost(selectedPort, {
    host: {
      ...host,
      serial: {
        async createFactoryByPath(path) {
          if (path !== selectedPort) throw new Error("Only the selected RCP port is available");
          return createBrowserSerialFactory(port);
        },
      },
    },
  });
}
