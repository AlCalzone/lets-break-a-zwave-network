import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TestContext } from 'node:test';

export function isolatedStateDirectory(t: TestContext) {
  const directory = resolve('.local', `test-sdrtop-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
