import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { SdrSetup } from '../src/terminal/protocol.ts';
import { validateSetup } from './validation.ts';

export class SetupStore {
  readonly directory: string;

  constructor(directory = process.env.SDRTOP_STATE_DIR || '.local/sdrtop') {
    this.directory = resolve(directory);
  }

  async load(): Promise<SdrSetup | null> {
    let contents: string;
    try {
      contents = await readFile(resolve(this.directory, 'setup.json'), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    try {
      return validateSetup(JSON.parse(contents));
    } catch (error) {
      throw new Error(`Invalid saved receiver setup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async save(setup: SdrSetup) {
    const validated = validateSetup(setup);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const staging = resolve(this.directory, `.setup-${randomUUID()}.json`);
    try {
      await writeFile(staging, `${JSON.stringify(validated, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      await rename(staging, resolve(this.directory, 'setup.json'));
    } finally {
      await rm(staging, { force: true });
    }
  }
}
