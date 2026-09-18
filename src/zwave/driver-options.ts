import type { Driver } from "zwave-js";
import type { HardwareSecurityOptions } from "./hardware";
import { requiredRegion } from "./radio-config";

export function mainDriverOptions(cacheDir: string, security: HardwareSecurityOptions = {}): NonNullable<ConstructorParameters<typeof Driver>[1]> {
  return {
    ...security,
    storage: { cacheDir },
    rf: { region: requiredRegion, preferLRRegion: false },
    attempts: { sendData: 1, sendDataJammed: 1 },
  };
}
