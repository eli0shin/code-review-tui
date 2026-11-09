import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHerdrCliAdapter } from '../src/tools/herdr-adapter.ts';
import type { PullRequestSummary } from '../src/domain/pull-request.ts';

const pullRequest = {
  url: 'https://github.example/acme/widgets/pull/42',
  repository: 'acme/widgets',
  number: 42,
  title: "Keep the caller's data",
  author: 'octocat',
  isDraft: false,
  state: 'open',
  createdAt: '2026-08-20T10:00:00Z',
  updatedAt: '2026-08-21T11:00:00Z',
  additions: 12,
  deletions: 3,
  changedFiles: 2,
  labels: ['review'],
  commentsCount: 4,
} satisfies PullRequestSummary;

const testOwner = `review-test-${process.pid}`;
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'review-herdr-'));
  await mkdir(join(directory, '.git'));
  const executable = join(directory, 'herdr');
  await writeFile(
    executable,
    `#!/usr/bin/env bun
const record = process.env.FAKE_HERDR_RECORD;
await Bun.write(record, (await Bun.file(record).exists() ? await Bun.file(record).text() : '') + JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.env.FAKE_HERDR_FAIL_ONCE) {
  const marker = process.env.FAKE_HERDR_FAIL_ONCE;
  if (!(await Bun.file(marker).exists())) {
    await Bun.write(marker, 'failed');
    await Bun.stderr.write('server unavailable\\n');
    process.exit(23);
  }
}
if (process.argv[2] === 'tab' && process.argv[3] === 'create') {
  if (process.env.FAKE_HERDR_MALFORMED) await Bun.stdout.write('{bad-json');
  else await Bun.stdout.write(JSON.stringify({ result: { tab: { tab_id: process.env.FAKE_HERDR_CREATED_TAB_ID ?? 'w1:t9', ignored: true }, root_pane: { pane_id: 'w1:p9', ignored: true } }, ignored: true }));
}
if (process.env.FAKE_HERDR_FAIL_CLEANUP_FOCUS && process.argv[2] === 'tab' && process.argv[3] === 'focus' && process.argv[4] === process.env.HERDR_TAB_ID) {
  process.exit(24);
}
if (process.env.FAKE_HERDR_EXECUTE_PANE && process.argv[2] === 'pane' && process.argv[3] === 'run') {
  const shell = process.env.FAKE_HERDR_PANE_SHELL ?? '/bin/sh';
  const shellArguments = process.env.FAKE_HERDR_PANE_SHELL_ARGUMENT ? [process.env.FAKE_HERDR_PANE_SHELL_ARGUMENT] : [];
  const result = Bun.spawnSync([shell, ...shellArguments, '-c', process.argv[5]], { env: process.env });
  await Bun.stderr.write(result.stderr);
  process.exit(result.exitCode);
}
`
  );
  await chmod(executable, 0o755);
  const lumen = join(directory, 'lumen');
  await writeFile(
    lumen,
    `#!/usr/bin/env bun
await Bun.stdout.write(process.env.FAKE_LUMEN_STDOUT ?? '');
process.exit(Number(process.env.FAKE_LUMEN_EXIT_CODE ?? '0'));
`
  );
  await chmod(lumen, 0o755);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  await rm(join('/tmp/review/lumen', testOwner), {
    recursive: true,
    force: true,
  });
  await rm(join(process.cwd(), `HACKED-${process.pid}`), { force: true });
});

describe('Herdr CLI adapter contract', () => {
  test('opens Lumen by default with exact Herdr CLI calls and inherited child environment', async () => {
    const herdr = createAdapter({ KEEP: 'yes' });

    expect(await herdr.openDiff(pullRequest)).toEqual({ ok: true });

    expect(await calls()).toEqual([
      [
        'tab',
        'create',
        '--workspace',
        'w1',
        '--cwd',
        directory,
        '--label',
        'Lumen acme/widgets#42',
        '--no-focus',
        '--env',
        'KEEP=yes',
      ],
      [
        'pane',
        'run',
        'w1:p9',
        `/bin/sh -c 'if comments=$(mktemp); then if lumen diff '"'"'https://github.example/acme/widgets/pull/42'"'"' >"$comments" && [ -s "$comments" ]; then mkdir -p '"'"'/tmp/review/lumen/acme/widgets'"'"' && mv "$comments" '"'"'/tmp/review/lumen/acme/widgets/42.txt'"'"' || rm -f "$comments"; else rm -f "$comments"; fi; fi; herdr tab focus '"'"'w1:t1'"'"'; herdr tab close '"'"'w1:t9'"'"''`,
      ],
      ['tab', 'focus', 'w1:t9'],
    ]);
  });

  test('runs the complete Lumen script through POSIX sh from real fish', async () => {
    const fish = Bun.which('fish');
    if (fish === null) return;
    const destination = join('/tmp/review/lumen', testOwner, 'fish', '76.txt');
    const herdr = createAdapter(
      {},
      {
        FAKE_HERDR_EXECUTE_PANE: '1',
        FAKE_HERDR_PANE_SHELL: fish,
        FAKE_HERDR_PANE_SHELL_ARGUMENT: '--no-config',
        FAKE_LUMEN_STDOUT: 'captured through fish',
      }
    );

    expect(
      await herdr.openDiff({
        ...pullRequest,
        repository: `${testOwner}/fish`,
        number: 76,
      })
    ).toEqual({ ok: true });
    expect(await readFile(destination, 'utf8')).toBe('captured through fish');
  });

  test('replaces the saved comments with exact nonempty Lumen stdout', async () => {
    const destination = join(
      '/tmp/review/lumen',
      testOwner,
      'capture',
      '73.txt'
    );
    const testedPullRequest = {
      ...pullRequest,
      repository: `${testOwner}/capture`,
      number: 73,
    };
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, 'old comments');

    const first = createAdapter(
      {},
      {
        FAKE_HERDR_EXECUTE_PANE: '1',
        FAKE_LUMEN_STDOUT: 'first comment\n---\nsecond comment',
      }
    );
    expect(await first.openDiff(testedPullRequest)).toEqual({ ok: true });
    expect(await readFile(destination, 'utf8')).toBe(
      'first comment\n---\nsecond comment'
    );

    const second = createAdapter(
      {},
      {
        FAKE_HERDR_EXECUTE_PANE: '1',
        FAKE_LUMEN_STDOUT: 'replacement without a trailing newline',
      }
    );
    expect(await second.openDiff(testedPullRequest)).toEqual({ ok: true });
    expect(await readFile(destination, 'utf8')).toBe(
      'replacement without a trailing newline'
    );
  });

  test('preserves saved comments when Lumen writes no stdout', async () => {
    const destination = join('/tmp/review/lumen', testOwner, 'empty', '74.txt');
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, 'keep these comments');
    const herdr = createAdapter(
      {},
      { FAKE_HERDR_EXECUTE_PANE: '1', FAKE_LUMEN_STDOUT: '' }
    );

    expect(
      await herdr.openDiff({
        ...pullRequest,
        repository: `${testOwner}/empty`,
        number: 74,
      })
    ).toEqual({ ok: true });
    expect(await readFile(destination, 'utf8')).toBe('keep these comments');
  });

  test('preserves saved comments when Lumen exits unsuccessfully', async () => {
    const destination = join(
      '/tmp/review/lumen',
      testOwner,
      'failed',
      '75.txt'
    );
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, 'keep these comments');
    const herdr = createAdapter(
      {},
      {
        FAKE_HERDR_EXECUTE_PANE: '1',
        FAKE_LUMEN_STDOUT: 'incomplete comments',
        FAKE_LUMEN_EXIT_CODE: '7',
      }
    );

    expect(
      await herdr.openDiff({
        ...pullRequest,
        repository: `${testOwner}/failed`,
        number: 75,
      })
    ).toEqual({ ok: true });
    expect(await readFile(destination, 'utf8')).toBe('keep these comments');
  });

  test('quotes pull request values in the Lumen command', async () => {
    const hacked = join(process.cwd(), `HACKED-${process.pid}`);
    const testedPullRequest = {
      ...pullRequest,
      url: `https://github.example/acme/widgets/pull/42'; touch HACKED-${process.pid}; echo '`,
      repository: `${testOwner}/repo'; touch HACKED-${process.pid}; echo '`,
    };
    const herdr = createAdapter(
      {},
      { FAKE_HERDR_EXECUTE_PANE: '1', FAKE_LUMEN_STDOUT: 'safe' }
    );

    expect(await herdr.openDiff(testedPullRequest)).toEqual({ ok: true });
    expect(await Bun.file(hacked).exists()).toBe(false);
  });

  test('opens the Review Command with exact pull request environment and shell command', async () => {
    const herdr = createAdapter({ KEEP: 'yes', REVIEW_PR_TITLE: 'old' });

    expect(await herdr.openReviewCommand(pullRequest)).toEqual({ ok: true });

    expect(await calls()).toEqual([
      [
        'tab',
        'create',
        '--workspace',
        'w1',
        '--cwd',
        directory,
        '--label',
        'Review acme/widgets#42',
        '--no-focus',
        '--env',
        'KEEP=yes',
        '--env',
        `REVIEW_PR_TITLE=${pullRequest.title}`,
        '--env',
        `REVIEW_PR_URL=${pullRequest.url}`,
        '--env',
        `REVIEW_PR_REPOSITORY=${pullRequest.repository}`,
        '--env',
        'REVIEW_PR_NUMBER=42',
        '--env',
        `REVIEW_PR_AUTHOR=${pullRequest.author}`,
        '--env',
        'REVIEW_PR_IS_DRAFT=false',
        '--env',
        `REVIEW_PR_STATE=${pullRequest.state}`,
        '--env',
        `REVIEW_PR_CREATED_AT=${pullRequest.createdAt}`,
        '--env',
        `REVIEW_PR_UPDATED_AT=${pullRequest.updatedAt}`,
      ],
      [
        'pane',
        'run',
        'w1:p9',
        `/bin/sh -c 'pi --prompt "Review $REVIEW_PR_URL"'; herdr tab focus 'w1:t1'; herdr tab close 'w1:t9'`,
      ],
      ['tab', 'focus', 'w1:t9'],
    ]);
  });

  test('opens the configured Diff Command instead of Lumen with the pull request environment', async () => {
    await rm(join(directory, '.git'), { recursive: true });
    const herdr = createAdapter(
      { KEEP: 'yes', REVIEW_PR_URL: 'old' },
      {},
      'w1:t1',
      undefined,
      `fish -c 'pr "$REVIEW_PR_URL"'`
    );

    expect(await herdr.openDiff(pullRequest)).toEqual({ ok: true });

    expect(await calls()).toEqual([
      [
        'tab',
        'create',
        '--workspace',
        'w1',
        '--cwd',
        directory,
        '--label',
        'Diff acme/widgets#42',
        '--no-focus',
        '--env',
        'KEEP=yes',
        '--env',
        `REVIEW_PR_URL=${pullRequest.url}`,
        '--env',
        `REVIEW_PR_REPOSITORY=${pullRequest.repository}`,
        '--env',
        'REVIEW_PR_NUMBER=42',
        '--env',
        `REVIEW_PR_TITLE=${pullRequest.title}`,
        '--env',
        `REVIEW_PR_AUTHOR=${pullRequest.author}`,
        '--env',
        'REVIEW_PR_IS_DRAFT=false',
        '--env',
        `REVIEW_PR_STATE=${pullRequest.state}`,
        '--env',
        `REVIEW_PR_CREATED_AT=${pullRequest.createdAt}`,
        '--env',
        `REVIEW_PR_UPDATED_AT=${pullRequest.updatedAt}`,
      ],
      [
        'pane',
        'run',
        'w1:p9',
        `/bin/sh -c 'fish -c '"'"'pr "$REVIEW_PR_URL"'"'"''; herdr tab focus 'w1:t1'; herdr tab close 'w1:t9'`,
      ],
      ['tab', 'focus', 'w1:t9'],
    ]);
  });

  test('returns malformed tab JSON as an immediate failure', async () => {
    const herdr = createAdapter({}, { FAKE_HERDR_MALFORMED: '1' });

    const result = await herdr.openReviewCommand(pullRequest);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected malformed JSON to fail');
    expect(result.failure.operation).toBe('createTab');
    expect(result.failure.message).toContain('malformed JSON');
    expect(await calls()).toHaveLength(1);
  });

  test('returns an immediate CLI failure and permits a later call', async () => {
    const marker = join(directory, 'failed-once');
    const herdr = createAdapter({}, { FAKE_HERDR_FAIL_ONCE: marker });

    expect(await herdr.openReviewCommand(pullRequest)).toEqual({
      ok: false,
      failure: {
        operation: 'createTab',
        message: 'Herdr CLI failed while trying to create a Herdr tab.',
        exitCode: 23,
        stderr: 'server unavailable\n',
      },
    });
    expect(await herdr.openReviewCommand(pullRequest)).toEqual({ ok: true });
    expect(await calls()).toHaveLength(4);
  });

  test('quotes both cleanup tab IDs after the launched command', async () => {
    const herdr = createAdapter(
      {},
      { FAKE_HERDR_CREATED_TAB_ID: "created'tab" },
      "queue'tab"
    );

    expect(await herdr.openReviewCommand(pullRequest)).toEqual({ ok: true });

    expect((await calls())[1]).toEqual([
      'pane',
      'run',
      'w1:p9',
      `/bin/sh -c 'pi --prompt "Review $REVIEW_PR_URL"'; herdr tab focus 'queue'"'"'tab'; herdr tab close 'created'"'"'tab'`,
    ]);
  });

  test('attempts tab close when best-effort Review Queue focus fails', async () => {
    const herdr = createAdapter(
      {},
      {
        FAKE_HERDR_EXECUTE_PANE: '1',
        FAKE_HERDR_FAIL_CLEANUP_FOCUS: '1',
      },
      'w1:t1',
      'true'
    );

    expect(await herdr.openReviewCommand(pullRequest)).toEqual({ ok: true });

    expect((await calls()).slice(2)).toEqual([
      ['tab', 'focus', 'w1:t1'],
      ['tab', 'close', 'w1:t9'],
      ['tab', 'focus', 'w1:t9'],
    ]);
  });
});

function createAdapter(
  environment: NodeJS.ProcessEnv,
  extraHerdrEnvironment: NodeJS.ProcessEnv = {},
  reviewQueueTabId = 'w1:t1',
  reviewCommand = 'pi --prompt "Review $REVIEW_PR_URL"',
  diffCommand?: string
) {
  return createHerdrCliAdapter({
    reviewCommand,
    diffCommand,
    workingDirectory: directory,
    environment,
    herdrEnvironment: {
      PATH: `${directory}:${process.env.PATH ?? ''}`,
      HERDR_ENV: '1',
      HERDR_WORKSPACE_ID: 'w1',
      HERDR_TAB_ID: reviewQueueTabId,
      FAKE_HERDR_RECORD: join(directory, 'calls.jsonl'),
      ...extraHerdrEnvironment,
    },
  });
}

async function calls(): Promise<unknown[][]> {
  const lines = (await readFile(join(directory, 'calls.jsonl'), 'utf8'))
    .trim()
    .split('\n');
  return lines.map(parseCall);
}

function parseCall(line: string): unknown[] {
  const value: unknown = JSON.parse(line);
  if (!Array.isArray(value)) throw new Error('fake Herdr call is not an array');
  return value;
}

describe('Herdr app adapter contract', () => {
  beforeEach(async () => {
    const executable = join(directory, 'herdr-app');
    await writeFile(
      executable,
      `#!/usr/bin/env bun
const record = process.env.FAKE_HERDR_RECORD;
const args = process.argv.slice(2);
await Bun.write(record, (await Bun.file(record).exists() ? await Bun.file(record).text() : '') + JSON.stringify(args) + '\\n');
const reply = async (value, code = 0) => { await Bun.stdout.write(JSON.stringify(value) + '\\n'); process.exit(code); };
if (args[0] === 'ls') {
  await reply({ spaces: [
    { id: 'vps/sp2', name: 'remote', machine: 'vps', tabs: [{ id: 'vps/tb2', terminals: [{ terminal: 'vps/t8' }] }] },
    { id: 'sp1', name: 'repo', machine: null, tabs: [{ id: 'tb1', terminals: [{ terminal: 't7' }] }] },
  ] });
}
if (args[0] === 'do' && args[1] === 'tab.new') {
  if (process.env.FAKE_HERDR_APP_FAIL) await reply({ error: 'no space sp1' }, 1);
  if (process.env.FAKE_HERDR_APP_EXECUTE) {
    // herdr-core starts the tab's terminal with its own identity.
    const { argv, folder } = JSON.parse(args[2]);
    const result = Bun.spawnSync(argv, { cwd: folder, env: { ...process.env, HC_TERMINAL_ID: 't9' } });
    await Bun.stderr.write(result.stderr);
  }
  await reply({ space: 'sp1', tab: 'tb9', terminal: 't9' });
}
await reply({ ok: true });
`
    );
    await chmod(executable, 0o755);
  });

  test('opens the Review Command in a new tab of the Review Queue space with the pull request environment', async () => {
    const herdr = createAppAdapter({
      KEEP: 'yes',
      REVIEW_PR_TITLE: 'old',
      HC_TERMINAL_ID: 't7',
      HC_SCOPE: 'review-scope',
    });

    expect(await herdr.openReviewCommand(pullRequest)).toEqual({ ok: true });

    const [list, create] = await calls();
    expect(list).toEqual(['ls']);
    expect(create.slice(0, 2)).toEqual(['do', 'tab.new']);
    expect(JSON.parse(String(create[2]))).toEqual({
      space: 'sp1',
      name: 'Review acme/widgets#42',
      folder: directory,
      argv: [
        '/usr/bin/env',
        'KEEP=yes',
        `REVIEW_PR_TITLE=${pullRequest.title}`,
        `REVIEW_PR_URL=${pullRequest.url}`,
        `REVIEW_PR_REPOSITORY=${pullRequest.repository}`,
        'REVIEW_PR_NUMBER=42',
        `REVIEW_PR_AUTHOR=${pullRequest.author}`,
        'REVIEW_PR_IS_DRAFT=false',
        `REVIEW_PR_STATE=${pullRequest.state}`,
        `REVIEW_PR_CREATED_AT=${pullRequest.createdAt}`,
        `REVIEW_PR_UPDATED_AT=${pullRequest.updatedAt}`,
        '/bin/sh',
        '-c',
        `/bin/sh -c 'pi --prompt "Review $REVIEW_PR_URL"'; herdr-app do pane.focus '{"terminal":"t7"}'; herdr-app do terminal.kill "{\\"terminal\\":\\"$HC_TERMINAL_ID\\"}"`,
      ],
    });
  });

  test('runs Lumen in the tab, saves its comments, refocuses the Review Queue, and ends its own terminal', async () => {
    const destination = join('/tmp/review/lumen', testOwner, 'app', '77.txt');
    const herdr = createAppAdapter(
      {},
      { FAKE_HERDR_APP_EXECUTE: '1', FAKE_LUMEN_STDOUT: 'app comments' }
    );

    expect(
      await herdr.openDiff({
        ...pullRequest,
        repository: `${testOwner}/app`,
        number: 77,
      })
    ).toEqual({ ok: true });

    expect(await readFile(destination, 'utf8')).toBe('app comments');
    expect((await calls()).slice(2)).toEqual([
      ['do', 'pane.focus', '{"terminal":"t7"}'],
      ['do', 'terminal.kill', '{"terminal":"t9"}'],
    ]);
  });

  test('uses the Herdr app when its terminal inherited Herdr context', async () => {
    const herdr = createAppAdapter(
      {},
      {
        HERDR_ENV: '1',
        HERDR_WORKSPACE_ID: 'w1',
        HERDR_TAB_ID: 'w1:t1',
      }
    );

    expect(await herdr.openReviewCommand(pullRequest)).toEqual({ ok: true });

    const [list, create] = await calls();
    expect(list).toEqual(['ls']);
    expect(create.slice(0, 2)).toEqual(['do', 'tab.new']);
  });

  test('falls back to Herdr when the window does not show an inherited terminal', async () => {
    const herdr = createAppAdapter(
      {},
      {
        HERDR_ENV: '1',
        HERDR_WORKSPACE_ID: 'w1',
        HERDR_TAB_ID: 'w1:t1',
      },
      't8'
    );

    expect(await herdr.openReviewCommand(pullRequest)).toEqual({ ok: true });

    const [list, create, run] = await calls();
    expect(list).toEqual(['ls']);
    expect(create.slice(0, 4)).toEqual(['tab', 'create', '--workspace', 'w1']);
    expect(run.slice(0, 3)).toEqual(['pane', 'run', 'w1:p9']);
  });

  test('refuses a terminal this window shows only on another machine', async () => {
    const herdr = createAppAdapter({}, {}, 't8');

    expect(await herdr.openReviewCommand(pullRequest)).toEqual({
      ok: false,
      failure: {
        operation: 'createTab',
        message:
          'The Herdr app window does not show this terminal. Run review in a Herdr app tab on this computer.',
        stderr: '',
      },
    });
    expect(await calls()).toEqual([['ls']]);
  });

  test('returns the Herdr app error when the tab cannot be created', async () => {
    const herdr = createAppAdapter({}, { FAKE_HERDR_APP_FAIL: '1' });

    expect(await herdr.openReviewCommand(pullRequest)).toEqual({
      ok: false,
      failure: {
        operation: 'createTab',
        message: 'Herdr app CLI failed while trying to create a Herdr tab.',
        exitCode: 1,
        stderr: '{"error":"no space sp1"}\n',
      },
    });
  });

  test('requires Herdr or the Herdr app', () => {
    expect(() =>
      createHerdrCliAdapter({
        reviewCommand: 'true',
        workingDirectory: directory,
        environment: {},
        herdrEnvironment: { PATH: process.env.PATH },
      })
    ).toThrow(
      'Start Herdr or the Herdr app, then run review inside one of its panes.'
    );
  });
});

function createAppAdapter(
  environment: NodeJS.ProcessEnv,
  extraHerdrEnvironment: NodeJS.ProcessEnv = {},
  terminal = 't7'
) {
  return createHerdrCliAdapter({
    reviewCommand: 'pi --prompt "Review $REVIEW_PR_URL"',
    workingDirectory: directory,
    environment,
    herdrEnvironment: {
      PATH: `${directory}:${process.env.PATH ?? ''}`,
      HC_TERMINAL_ID: terminal,
      FAKE_HERDR_RECORD: join(directory, 'calls.jsonl'),
      ...extraHerdrEnvironment,
    },
  });
}
