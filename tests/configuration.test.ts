import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  loadReviewConfiguration,
  readUpdateConfiguration,
} from '../src/configuration/index.ts';

let testDirectory: string | undefined;

const completeConfiguration = {
  github: { search: 'review-requested:@me state:open' },
  reviewCommand: 'pi --prompt "Review $REVIEW_PR_URL"',
};

const generatedConfiguration = {
  github: { search: 'is:pr review-requested:@me state:open' },
  reviewCommand:
    'pi "review the changes in this pr and report your findings to me: $REVIEW_PR_URL"',
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
  config: { updateBehavior: 'auto', updateCheckIntervalHours: 24 },
} as const;

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
    expect(await Bun.file(file).text()).toBe(
      JSON.stringify(completeConfiguration)
    );
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

  test('creates and loads complete formatted defaults when the file and parent directories are missing', async () => {
    const { file, environment } = await makeEnvironment();
    await rm(dirname(file), { recursive: true });

    expect(await loadReviewConfiguration(environment)).toEqual({
      ok: true,
      value: {
        githubSearch: ['is:pr', 'review-requested:@me', 'state:open'],
        reviewCommand: generatedConfiguration.reviewCommand,
        keyBindings: generatedConfiguration.keyBindings,
        update: generatedConfiguration.config,
      },
    });
    expect(await Bun.file(file).text()).toBe(
      `${JSON.stringify(generatedConfiguration, null, 2)}\n`
    );
  });

  test('does not overwrite a configuration created concurrently', async () => {
    const { file, environment } = await makeEnvironment();
    const concurrentConfiguration = {
      ...completeConfiguration,
      github: { search: 'is:pr author:octocat' },
    };
    const concurrentText = JSON.stringify(concurrentConfiguration);
    const concurrentWrite = writeFile(file, concurrentText, {
      flag: 'wx',
    }).catch((error: unknown) => {
      expect(
        typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code
      ).toBe('EEXIST');
    });

    const [result] = await Promise.all([
      loadReviewConfiguration(environment),
      concurrentWrite,
    ]);
    const finalText = await Bun.file(file).text();

    expect([
      concurrentText,
      `${JSON.stringify(generatedConfiguration, null, 2)}\n`,
    ]).toContain(finalText);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected valid configuration');
    expect(result.value.githubSearch).toEqual(
      finalText === concurrentText
        ? ['is:pr', 'author:octocat']
        : ['is:pr', 'review-requested:@me', 'state:open']
    );
  });

  test('reports malformed JSON without replacing it', async () => {
    const { file, environment } = await makeEnvironment();
    await Bun.write(file, '{"github":');

    expectFailure(
      await loadReviewConfiguration(environment),
      file,
      undefined,
      /JSON/i
    );
    expect(await Bun.file(file).text()).toBe('{"github":');
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

  test('keeps line feed distinct from Enter with and without Alt', async () => {
    const { file, environment } = await makeEnvironment();
    await writeConfiguration(file, {
      ...completeConfiguration,
      keyBindings: {
        selectPrevious: ['enter'],
        selectNext: ['ctrl+j'],
        openDiff: ['alt+enter'],
        runReviewCommand: ['ctrl+alt+j'],
      },
    });

    const result = await loadReviewConfiguration(environment);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected valid configuration');
    expect(result.value.keyBindings.selectPrevious).toEqual(['enter']);
    expect(result.value.keyBindings.selectNext).toEqual(['ctrl+j']);
    expect(result.value.keyBindings.openDiff).toEqual(['alt+enter']);
    expect(result.value.keyBindings.runReviewCommand).toEqual(['ctrl+alt+j']);
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

  test('reports shifted space aliases on conventional terminals', async () => {
    const { file, environment } = await makeEnvironment();
    await writeConfiguration(file, {
      ...completeConfiguration,
      keyBindings: {
        selectPrevious: ['space'],
        quit: ['shift+space'],
      },
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

  test('reports shifted digit aliases on conventional terminals', async () => {
    const aliases = [
      ['!', 'shift+1'],
      ['@', 'shift+2'],
      ['#', 'shift+3'],
      ['$', 'shift+4'],
      ['%', 'shift+5'],
      ['^', 'shift+6'],
      ['&', 'shift+7'],
      ['*', 'shift+8'],
      ['(', 'shift+9'],
      [')', 'shift+0'],
    ];

    for (const [printable, shifted] of aliases) {
      const { file, environment } = await makeEnvironment();
      await writeConfiguration(file, {
        ...completeConfiguration,
        keyBindings: {
          selectPrevious: [printable],
          quit: [shifted],
        },
      });

      expectFailure(
        await loadReviewConfiguration(environment),
        file,
        'keyBindings.quit',
        /collision/i
      );

      const directory = testDirectory;
      if (directory === undefined) throw new Error('Expected test directory');
      await rm(directory, { recursive: true, force: true });
      testDirectory = undefined;
    }
  });

  test('reports control-digit aliases on conventional terminals', async () => {
    const aliases = [
      ['ctrl+space', 'ctrl+2'],
      ['ctrl+space', 'ctrl+shift+2'],
      ['escape', 'ctrl+3'],
      ['escape', 'ctrl+shift+3'],
      ['backspace', 'ctrl+8'],
      ['backspace', 'ctrl+shift+8'],
      ['ctrl+alt+space', 'ctrl+alt+2'],
      ['ctrl+alt+space', 'ctrl+alt+shift+2'],
      ['alt+escape', 'ctrl+alt+3'],
      ['alt+escape', 'ctrl+alt+shift+3'],
      ['alt+backspace', 'ctrl+alt+8'],
      ['alt+backspace', 'ctrl+alt+shift+8'],
    ];

    for (const [named, control] of aliases) {
      const { file, environment } = await makeEnvironment();
      await writeConfiguration(file, {
        ...completeConfiguration,
        keyBindings: {
          selectPrevious: [named],
          quit: [control],
        },
      });

      expectFailure(
        await loadReviewConfiguration(environment),
        file,
        'keyBindings.quit',
        /collision/i
      );

      const directory = testDirectory;
      if (directory === undefined) throw new Error('Expected test directory');
      await rm(directory, { recursive: true, force: true });
      testDirectory = undefined;
    }
  });

  test('reports Alt control-character aliases on conventional terminals', async () => {
    const aliases = [
      ['alt+backspace', 'ctrl+alt+h'],
      ['alt+tab', 'ctrl+alt+i'],
      ['alt+enter', 'ctrl+alt+m'],
    ];

    for (const [named, control] of aliases) {
      const { file, environment } = await makeEnvironment();
      await writeConfiguration(file, {
        ...completeConfiguration,
        keyBindings: {
          selectPrevious: [named],
          quit: [control],
        },
      });

      const failure = expectFailure(
        await loadReviewConfiguration(environment),
        file,
        'keyBindings.quit',
        /collision/i
      );
      expect(failure.problem).toContain('selectPrevious');
      expect(failure.problem).toContain('quit');

      const directory = testDirectory;
      if (directory === undefined) throw new Error('Expected test directory');
      await rm(directory, { recursive: true, force: true });
      testDirectory = undefined;
    }
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
