import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getUpdateConfigFromFile } from '../src/cli.tsx';
import { getReviewConfigPath } from '../src/configuration/index.ts';

let testDirectory: string | undefined;

afterEach(async () => {
  if (testDirectory !== undefined) {
    await rm(testDirectory, { recursive: true, force: true });
    testDirectory = undefined;
  }
});

describe('update configuration', () => {
  test('reads update behavior from the default path when XDG_CONFIG_HOME is empty', async () => {
    testDirectory = await mkdtemp(join(tmpdir(), 'review-config-'));
    const path = getReviewConfigPath({ XDG_CONFIG_HOME: '' }, testDirectory);
    await mkdir(join(testDirectory, '.config', 'review'), { recursive: true });
    await Bun.write(
      path,
      JSON.stringify({ config: { updateBehavior: 'notify' } })
    );

    expect(path).toBe(join(testDirectory, '.config', 'review', 'config.json'));
    expect(await getUpdateConfigFromFile(path)).toEqual({
      behavior: 'notify',
      checkIntervalHours: 24,
    });
  });

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
