import type { ZWaveSerialBindingFactory } from "@zwave-js/serial";

export function createBrowserSerialFactory(port: SerialPort): ZWaveSerialBindingFactory {
  return async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
    let reading: Promise<void> | undefined;
    return {
      source: {
        start(controller) {
          const current = port.readable!.getReader();
          reader = current;
          reading = (async () => {
            try {
              for (;;) {
                const { value, done } = await current.read();
                if (done) break;
                controller.enqueue(new Uint8Array(value));
              }
            } finally {
              current.releaseLock();
              if (reader === current) reader = undefined;
            }
          })();
          return reading;
        },
        async cancel() { await reader?.cancel(); await reading; },
      },
      sink: {
        async write(data) {
          writer ??= port.writable!.getWriter();
          await writer.write(data);
        },
        async close() {
          writer?.releaseLock();
          writer = undefined;
          await reader?.cancel();
          await reading;
        },
      },
    };
  };
}
