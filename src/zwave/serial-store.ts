import type { HardwareKind } from "./hardware";

export const serialSelectionStorageKey = "zwave-presentation.serial-selections.v1";

export interface SavedSerialSelection {
  kind: HardwareKind;
  id: string;
  usbVendorId?: number;
  usbProductId?: number;
  ordinal: number;
}

function isHardwareKind(value: unknown): value is HardwareKind {
  return value === "main" || value === "zniffer" || value === "rcp";
}

function validateSelection(value: unknown): SavedSerialSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Saved serial selections have an invalid entry.");
  const selection = value as Record<string, unknown>;
  if (!isHardwareKind(selection.kind) || typeof selection.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(selection.id)
    || !Number.isInteger(selection.ordinal) || (selection.ordinal as number) < 0
    || (selection.usbVendorId !== undefined && !Number.isInteger(selection.usbVendorId))
    || (selection.usbProductId !== undefined && !Number.isInteger(selection.usbProductId))) {
    throw new Error("Saved serial selections have an invalid entry.");
  }
  return {
    kind: selection.kind,
    id: selection.id,
    ordinal: selection.ordinal as number,
    ...(selection.usbVendorId === undefined ? {} : { usbVendorId: selection.usbVendorId as number }),
    ...(selection.usbProductId === undefined ? {} : { usbProductId: selection.usbProductId as number }),
  };
}

function samePortInfo(left: SerialPortInfo, right: Pick<SavedSerialSelection, "usbVendorId" | "usbProductId">) {
  return left.usbVendorId === right.usbVendorId && left.usbProductId === right.usbProductId;
}

export function loadSerialSelections(storage: Pick<Storage, "getItem">): SavedSerialSelection[] {
  const text = storage.getItem(serialSelectionStorageKey);
  if (text === null) return [];
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error("Saved serial selections contain invalid JSON."); }
  if (!Array.isArray(value)) throw new Error("Saved serial selections have an invalid format.");
  const selections = value.map(validateSelection);
  if (new Set(selections.map(selection => `${selection.kind}:${selection.id}`)).size !== selections.length) {
    throw new Error("Saved serial selections contain duplicate connections.");
  }
  return selections;
}

export function saveSerialSelection(
  storage: Pick<Storage, "getItem" | "setItem">,
  kind: HardwareKind,
  id: string,
  port: SerialPort,
  grantedPorts: readonly SerialPort[],
) {
  const info = port.getInfo();
  const matches = grantedPorts.filter(candidate => samePortInfo(candidate.getInfo(), info));
  const ordinal = matches.indexOf(port);
  if (ordinal < 0) throw new Error("The selected serial port is not in the granted-port list.");
  const selections = loadSerialSelections(storage).filter(selection => !(selection.kind === kind && selection.id === id));
  selections.push({ kind, id, ordinal, usbVendorId: info.usbVendorId, usbProductId: info.usbProductId });
  storage.setItem(serialSelectionStorageKey, JSON.stringify(selections));
}

export function findSavedSerialPort(
  selection: SavedSerialSelection,
  grantedPorts: readonly SerialPort[],
) {
  return grantedPorts.filter(port => samePortInfo(port.getInfo(), selection))[selection.ordinal];
}
