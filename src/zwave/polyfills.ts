const globals = globalThis as typeof globalThis & {
  setImmediate?: (callback: (...args: unknown[]) => void, ...args: unknown[]) => number;
  clearImmediate?: (handle: number) => void;
};

globals.setImmediate ??= ((callback: (...args: unknown[]) => void, ...args: unknown[]) =>
  globalThis.setTimeout(callback, 0, ...args)) as typeof globals.setImmediate;
globals.clearImmediate ??= ((handle: number) => globalThis.clearTimeout(handle)) as typeof globals.clearImmediate;
