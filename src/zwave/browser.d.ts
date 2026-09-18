/// <reference types="w3c-web-serial" />

declare module "virtual:zwave-config" {
  const files: Record<string, number>;
  export default files;
}

declare module "zwave-js/experimental-rcp" {
  export const RCPHost: typeof import("zwave-js").RCPHost;
}
