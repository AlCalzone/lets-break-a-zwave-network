import type { FileSystem, FSStats } from "@zwave-js/shared/bindings";

export function createBrowserFileSystem(
  cache: FileSystem,
  files: Record<string, number>,
  fetchFile: typeof fetch = fetch,
): FileSystem {
  const root = "/zwave-config";
  const directories = new Set<string>([root]);
  for (const name of Object.keys(files)) {
    const parts = name.split("/");
    while (parts.length > 1) {
      parts.pop();
      directories.add(`${root}/${parts.join("/")}`);
    }
  }
  const normalize = (value: string) => value
    // The official configDir is a URL. Its path join removes one slash from the scheme
    .replace(/^https?:\/+[^/]+\/config(?=\/|$)/, root)
    .replace(/^\/config(?=\/|$)/, root)
    .replace(/\/+$/, "");
  const relative = (value: string) => value.slice(root.length + 1);
  const stats = (directory: boolean, size = 0): FSStats => ({
    isDirectory: () => directory,
    isFile: () => !directory,
    // Configuration assets share a fixed timestamp because the index is generated at build time
    mtime: new Date(0),
    size,
  });
  const fs: FileSystem = {
    async readFile(filename) {
      filename = normalize(filename);
      if (filename.startsWith(`${root}/`)) {
        if (!(relative(filename) in files)) throw new Error(`Configuration file not found: ${filename}`);
        const response = await fetchFile(filename);
        if (!response.ok) throw new Error(`Cannot load ${filename}: HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      }
      return cache.readFile(filename);
    },
    async stat(filename) {
      filename = normalize(filename);
      if (directories.has(filename)) return stats(true);
      if (filename.startsWith(`${root}/`) && relative(filename) in files) {
        return stats(false, files[relative(filename)]);
      }
      try { return stats(false, (await cache.readFile(filename)).byteLength); }
      catch {
        if ((await cache.readDir(`${filename}/`)).length) return stats(true);
        throw new Error(`File not found: ${filename}`);
      }
    },
    async readDir(dirname) {
      dirname = normalize(dirname);
      if (directories.has(dirname)) {
        const prefix = `${dirname}/`;
        return [...new Set(Object.keys(files).map(name => `${root}/${name}`)
          .filter(name => name.startsWith(prefix)).map(name => name.slice(prefix.length).split("/")[0]))];
      }
      const prefix = `${dirname}/`;
      return [...new Set((await cache.readDir(prefix)).map(name => name.slice(prefix.length).split("/")[0]))];
    },
    async writeFile(filename, data) {
      filename = normalize(filename);
      if (filename.startsWith(`${root}/`)) throw new Error("Bundled Z-Wave configuration is read-only");
      return cache.writeFile(filename, data);
    },
    async copyFile(source, dest) { return fs.writeFile(dest, await fs.readFile(source)); },
    open: (filename, flags) => cache.open(filename, flags),
    ensureDir: dirname => cache.ensureDir(dirname),
    deleteDir: dirname => cache.deleteDir(`${normalize(dirname)}/`),
    makeTempDir: prefix => cache.makeTempDir(prefix),
  };
  return fs;
}
