import type { Database, DatabaseFactory, DatabaseOptions } from "@zwave-js/shared/bindings";

interface Entry { key: string; value: unknown; timestamp?: number }

export const database: DatabaseFactory = {
  createInstance<V>(filename: string, options: DatabaseOptions<V> = {}): Database<V> {
    const values = new Map<string, { value: V; timestamp?: number }>();
    let connection: IDBDatabase;
    let pending = Promise.resolve();
    let failure: unknown;
    function write(action: (store: IDBObjectStore) => void) {
      pending = pending.then(() => new Promise<void>((resolve, reject) => {
        const transaction = connection.transaction("entries", "readwrite");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
        action(transaction.objectStore("entries"));
      })).catch(error => { failure = error; });
    }
    return {
      async open() {
        connection = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(`zwave-presentation:${filename}`, 1);
          request.onupgradeneeded = () => request.result.createObjectStore("entries", { keyPath: "key" });
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const entries = await new Promise<Entry[]>((resolve, reject) => {
          const request = connection.transaction("entries").objectStore("entries").getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        for (const entry of entries) {
          values.set(entry.key, {
            value: options.reviver ? options.reviver(entry.key, entry.value) : entry.value as V,
            timestamp: entry.timestamp,
          });
        }
      },
      async close() {
        await pending;
        connection?.close();
        values.clear();
        if (failure) throw failure;
      },
      has: key => values.has(key),
      get: key => values.get(key)?.value,
      set(key, value, updateTimestamp = true) {
        const timestamp = options.enableTimestamps && updateTimestamp
          ? Date.now() : values.get(key)?.timestamp;
        const serialized = options.serializer ? options.serializer(key, value) : value;
        values.set(key, { value, timestamp });
        write(store => store.put({ key, value: serialized, timestamp }));
        return this;
      },
      delete(key) {
        const removed = values.delete(key);
        write(store => store.delete(key));
        return removed;
      },
      clear() { values.clear(); write(store => store.clear()); },
      getTimestamp: key => values.get(key)?.timestamp,
      get size() { return values.size; },
      keys: () => values.keys(),
      entries: () => new Map([...values].map(([key, entry]) => [key, entry.value])).entries(),
    };
  },
};
