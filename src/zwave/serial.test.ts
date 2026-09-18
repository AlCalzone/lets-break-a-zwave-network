import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createBrowserSerialFactory } from "./serial";

test("closing the binding cancels a pending read and releases both locks", async () => {
  let cancelled = false;
  const writes: Uint8Array[] = [];
  const readable = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const writable = new WritableStream<Uint8Array>({ write(data) { writes.push(data); } });
  const binding = await createBrowserSerialFactory({ readable, writable } as SerialPort)();
  const input = new ReadableStream(binding.source);
  const output = new WritableStream(binding.sink);
  const writer = output.getWriter();
  await writer.write(new Uint8Array([1, 2]));
  await writer.close();
  assert.equal(cancelled, true);
  assert.equal(readable.locked, false);
  assert.equal(writable.locked, false);
  assert.deepEqual(writes, [new Uint8Array([1, 2])]);
  await input.cancel();
});
