import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getUpdateConfigFromFile } from '../src/cli.tsx';

let testDirectory: string | undefined;

afterEach(async () => {
  if (testDirectory !== undefined) {
    await rm(testDirectory, { recursive: true, force: true });
    testDirectory = undefined;
  }
});

describe('update configuration', () => {
  test('disables automatic updates when the config is invalid', async () => {
    testDirectory = await mkdtemp(join(tmpdir(), 'review-config-'));
    const path = join(testDirectory, 'config.json');
    await Bun.write(
      path,
      JSON.stringify({
        config: {
          updateBehavior: 'off',
          updateCheckIntervalHours: 'twelve',
        },
      })
    );

    expect(await getUpdateConfigFromFile(path)).toEqual({
      behavior: 'off',
      checkIntervalHours: 24,
    });
  });
});
