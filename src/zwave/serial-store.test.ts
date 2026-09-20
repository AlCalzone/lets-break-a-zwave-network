import assert from "node:assert/strict";
import test from "node:test";
import {
  findSavedSerialPort,
  loadSerialSelections,
  saveSerialSelection,
  serialSelectionStorageKey,
} from "./serial-store";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

function port(usbVendorId: number, usbProductId: number) {
  return { getInfo: () => ({ usbVendorId, usbProductId }) } as SerialPort;
}

test("saved selections retain a port's ordinal among identical granted devices", () => {
  const ports = [port(1, 2), port(1, 2), port(3, 4)];
  const saved = storage();
  saveSerialSelection(saved, "rcp", "rcp-2", ports[1], ports);
  const [selection] = loadSerialSelections(saved);
  assert.deepEqual(selection, { kind: "rcp", id: "rcp-2", ordinal: 1, usbVendorId: 1, usbProductId: 2 });
  assert.equal(findSavedSerialPort(selection, ports), ports[1]);
});

test("saving a connection replaces its prior serial selection", () => {
  const ports = [port(1, 2), port(3, 4)];
  const saved = storage();
  saveSerialSelection(saved, "main", "main", ports[0], ports);
  saveSerialSelection(saved, "main", "main", ports[1], ports);
  assert.deepEqual(loadSerialSelections(saved), [
    { kind: "main", id: "main", ordinal: 0, usbVendorId: 3, usbProductId: 4 },
  ]);
});

test("invalid saved serial selections are explicit errors", () => {
  const saved = storage();
  saved.setItem(serialSelectionStorageKey, "{invalid json");
  assert.throws(() => loadSerialSelections(saved), /invalid JSON/);
  saved.setItem(serialSelectionStorageKey, JSON.stringify([{ kind: "rcp", id: "rcp-1", ordinal: -1 }]));
  assert.throws(() => loadSerialSelections(saved), /invalid entry/);
});
