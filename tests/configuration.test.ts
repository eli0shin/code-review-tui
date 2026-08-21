import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadReviewConfiguration,
  readUpdateConfiguration,
} from '../src/configuration/index.ts';

let testDirectory: string | undefined;

const completeConfiguration = {
  github: { search: 'review-requested:@me state:open' },
  reviewCommand: 'pi --prompt "Review $REVIEW_PR_URL"',
};

async function makeEnvironment(useXdg = true) {
  testDirectory = await mkdtemp(join(tmpdir(), 'review-configuration-'));
  const home = join(testDirectory, 'home');
  const xdg = join(testDirectory, 'xdg');
  const configHome = useXdg ? xdg : join(home, '.config');
  const file = join(configHome, 'review', 'config.json');
  await mkdir(join(configHome, 'review'), { recursive: true });
  return {
    file,
    environment: {
      HOME: home,
      XDG_CONFIG_HOME: useXdg ? xdg : '',
    },
  };
}

async function writeConfiguration(file: string, value: unknown) {
  await Bun.write(file, JSON.stringify(value));
}

function expectFailure(
  result: Awaited<ReturnType<typeof loadReviewConfiguration>>,
  file: string,
  field: string | undefined,
  problem: RegExp
) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected configuration failure');
  const { failure } = result;
  expect(failure.file).toBe(file);
  expect(failure.field).toBe(field);
  expect(failure.problem).toMatch(problem);
  return failure;
}

afterEach(async () => {
  if (testDirectory !== undefined) {
    await rm(testDirectory, { recursive: true, force: true });
    testDirectory = undefined;
  }
});

describe('Review configuration contract', () => {
  test('loads complete XDG configuration and applies omitted defaults', async () => {
    const { file, environment } = await makeEnvironment();
    await writeConfiguration(file, completeConfiguration);

    expect(await loadReviewConfiguration(environment)).toEqual({
      ok: true,
      value: {
        githubSearch: ['review-requested:@me', 'state:open'],
        reviewCommand: 'pi --prompt "Review $REVIEW_PR_URL"',
        keyBindings: {
          selectPrevious: ['k', 'up'],
          selectNext: ['j', 'down'],
          openDiff: ['d', 'enter'],
          runReviewCommand: ['c'],
          composeReviewSubmission: ['s'],
          refresh: ['r'],
          showHelp: ['?'],
          quit: ['q'],
        },
        update: { updateBehavior: 'auto', updateCheckIntervalHours: 24 },
      },
    });
  });

  test('uses HOME when XDG_CONFIG_HOME is relative', async () => {
    const { file, environment } = await makeEnvironment(false);
    await writeConfiguration(file, completeConfiguration);

    const result = await loadReviewConfiguration({
      ...environment,
      XDG_CONFIG_HOME: 'relative/config',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected valid configuration');
    expect(result.value.githubSearch).toEqual([
      'review-requested:@me',
      'state:open',
    ]);
  });

  test('preserves the opaque Review Command and tokenizes grouped search terms', async () => {
    const { file, environment } = await makeEnvironment();
    const reviewCommand =
      'printf \'{{url}} %s\\n\' "$REVIEW_PR_TITLE" | tee >review.txt';
    await writeConfiguration(file, {
      ...completeConfiguration,
      github: {
        search: 'label:"needs review" \'fix login\' author:octo\\ cat ""',
      },
      reviewCommand,
      keyBindings: { openDiff: ['A'], selectNext: ['ctrl+alt+shift+j'] },
      config: { updateBehavior: 'notify', updateCheckIntervalHours: 12 },
    });

    expect(await loadReviewConfiguration(environment)).toEqual({
      ok: true,
      value: {
        githubSearch: [
          'label:needs review',
          'fix login',
          'author:octo cat',
          '',
        ],
        reviewCommand,
        keyBindings: {
          selectPrevious: ['k', 'up'],
          selectNext: ['ctrl+alt+j'],
          openDiff: ['shift+a'],
          runReviewCommand: ['c'],
          composeReviewSubmission: ['s'],
          refresh: ['r'],
          showHelp: ['?'],
          quit: ['q'],
        },
        update: { updateBehavior: 'notify', updateCheckIntervalHours: 12 },
      },
    });
  });

  test('reports a missing file', async () => {
    const { file, environment } = await makeEnvironment();

    expectFailure(
      await loadReviewConfiguration(environment),
      file,
      undefined,
      /read|required|exist/i
    );
  });

  test('reports malformed JSON', async () => {
    const { file, environment } = await makeEnvironment();
    await Bun.write(file, '{"github":');

    expectFailure(
      await loadReviewConfiguration(environment),
      file,
      undefined,
      /JSON/i
    );
  });

  const invalidFields: readonly {
    name: string;
    value: unknown;
    field: string;
    problem: RegExp;
  }[] = [
    {
      name: 'unknown top-level field',
      value: { ...completeConfiguration, reviewComand: 'typo' },
      field: 'reviewComand',
      problem: /unknown/i,
    },
    {
      name: 'unknown nested field',
      value: {
        ...completeConfiguration,
        github: { search: 'state:open', host: 'github.com' },
      },
      field: 'github.host',
      problem: /unknown/i,
    },
    {
      name: 'missing required field',
      value: { github: completeConfiguration.github },
      field: 'reviewCommand',
      problem: /required/i,
    },
    {
      name: 'wrong field type',
      value: { ...completeConfiguration, github: { search: ['state:open'] } },
      field: 'github.search',
      problem: /string/i,
    },
    {
      name: 'blank required string',
      value: { ...completeConfiguration, reviewCommand: ' \t\n' },
      field: 'reviewCommand',
      problem: /blank|non-whitespace/i,
    },
    {
      name: 'empty binding list',
      value: { ...completeConfiguration, keyBindings: { quit: [] } },
      field: 'keyBindings.quit',
      problem: /at least one/i,
    },
    {
      name: 'wrong updater setting type',
      value: {
        ...completeConfiguration,
        config: { updateCheckIntervalHours: '12' },
      },
      field: 'config.updateCheckIntervalHours',
      problem: /number/i,
    },
  ];

  for (const invalid of invalidFields) {
    test(`reports ${invalid.name}`, async () => {
      const { file, environment } = await makeEnvironment();
      await writeConfiguration(file, invalid.value);

      expectFailure(
        await loadReviewConfiguration(environment),
        file,
        invalid.field,
        invalid.problem
      );
    });
  }

  test('reports invalid search quotation and dangling escapes', async () => {
    for (const search of ['"not closed', 'state:open\\', '"" \'\'']) {
      const { file, environment } = await makeEnvironment();
      await writeConfiguration(file, {
        ...completeConfiguration,
        github: { search },
      });

      expectFailure(
        await loadReviewConfiguration(environment),
        file,
        'github.search',
        /quote|backslash|nonempty/i
      );
      const directory = testDirectory;
      if (directory === undefined) throw new Error('Expected test directory');
      await rm(directory, { recursive: true, force: true });
      testDirectory = undefined;
    }
  });

  test('reports invalid key descriptors', async () => {
    const { file, environment } = await makeEnvironment();
    await writeConfiguration(file, {
      ...completeConfiguration,
      keyBindings: { quit: ['esc'] },
    });

    expectFailure(
      await loadReviewConfiguration(environment),
      file,
      'keyBindings.quit',
      /descriptor/i
    );
  });

  test('reports aliases duplicated in one action', async () => {
    const { file, environment } = await makeEnvironment();
    await writeConfiguration(file, {
      ...completeConfiguration,
      keyBindings: { quit: ['A', 'shift+a'] },
    });

    expectFailure(
      await loadReviewConfiguration(environment),
      file,
      'keyBindings.quit',
      /duplicate|same terminal key/i
    );
  });

  test('reports both actions in a normalized key collision', async () => {
    const { file, environment } = await makeEnvironment();
    await writeConfiguration(file, {
      ...completeConfiguration,
      keyBindings: { selectPrevious: ['A'], quit: ['shift+a'] },
    });

    const result = await loadReviewConfiguration(environment);
    const failure = expectFailure(
      result,
      file,
      'keyBindings.quit',
      /collision/i
    );
    expect(failure.problem).toContain('selectPrevious');
    expect(failure.problem).toContain('quit');
  });

  test('reports control-character aliases duplicated in one action', async () => {
    const { file, environment } = await makeEnvironment();
    await writeConfiguration(file, {
      ...completeConfiguration,
      keyBindings: { openDiff: ['enter', 'ctrl+m'] },
    });

    expectFailure(
      await loadReviewConfiguration(environment),
      file,
      'keyBindings.openDiff',
      /same terminal key/i
    );
  });

  test('reports control-character aliases assigned to different actions', async () => {
    const { file, environment } = await makeEnvironment();
    await writeConfiguration(file, {
      ...completeConfiguration,
      keyBindings: { selectPrevious: ['tab'], quit: ['ctrl+i'] },
    });

    const failure = expectFailure(
      await loadReviewConfiguration(environment),
      file,
      'keyBindings.quit',
      /collision/i
    );
    expect(failure.problem).toContain('selectPrevious');
    expect(failure.problem).toContain('quit');
  });

  test('reports shifted control-key aliases on conventional terminals', async () => {
    const { file, environment } = await makeEnvironment();
    await writeConfiguration(file, {
      ...completeConfiguration,
      keyBindings: {
        selectPrevious: ['ctrl+r'],
        refresh: ['ctrl+shift+r'],
      },
    });

    const failure = expectFailure(
      await loadReviewConfiguration(environment),
      file,
      'keyBindings.refresh',
      /collision/i
    );
    expect(failure.problem).toContain('selectPrevious');
    expect(failure.problem).toContain('refresh');
  });

  test('normalizes shifted control characters to named keys', async () => {
    const { file, environment } = await makeEnvironment();
    await writeConfiguration(file, {
      ...completeConfiguration,
      keyBindings: {
        openDiff: ['backspace'],
        quit: ['ctrl+shift+h'],
      },
    });

    const failure = expectFailure(
      await loadReviewConfiguration(environment),
      file,
      'keyBindings.quit',
      /collision/i
    );
    expect(failure.problem).toContain('openDiff');
    expect(failure.problem).toContain('quit');
  });
});

describe('updater-only configuration', () => {
  test('does not require TUI fields and tolerates unrelated valid fields', async () => {
    const { file, environment } = await makeEnvironment();
    await writeConfiguration(file, {
      unrelated: true,
      config: {
        updateBehavior: 'notify',
        updateCheckIntervalHours: 12,
        futureSetting: true,
      },
    });

    expect(await readUpdateConfiguration(environment)).toEqual({
      updateBehavior: 'notify',
      updateCheckIntervalHours: 12,
    });
  });

  test('uses defaults when the file is missing or updater settings are omitted', async () => {
    const { file, environment } = await makeEnvironment();
    await writeConfiguration(file, { unrelated: true });
    expect(await readUpdateConfiguration(environment)).toEqual({
      updateBehavior: 'auto',
      updateCheckIntervalHours: 24,
    });

    await rm(file);
    expect(await readUpdateConfiguration(environment)).toEqual({
      updateBehavior: 'auto',
      updateCheckIntervalHours: 24,
    });
  });

  test('disables updates for malformed or invalid updater configuration', async () => {
    const { file, environment } = await makeEnvironment();
    const invalidValues = [
      'not JSON',
      JSON.stringify([]),
      JSON.stringify({ config: 'invalid' }),
      JSON.stringify({ config: { updateBehavior: 'sometimes' } }),
      JSON.stringify({
        config: {
          updateBehavior: 'notify',
          updateCheckIntervalHours: 'twelve',
        },
      }),
    ];

    for (const value of invalidValues) {
      await Bun.write(file, value);
      expect(await readUpdateConfiguration(environment)).toEqual({
        updateBehavior: 'off',
        updateCheckIntervalHours: 24,
      });
    }
  });
});
