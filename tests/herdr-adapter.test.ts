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
} satisfies PullRequestSummary;

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
  else await Bun.stdout.write(JSON.stringify({ result: { tab: { tab_id: 'w1:t9', ignored: true }, root_pane: { pane_id: 'w1:p9', ignored: true } }, ignored: true }));
}
`
  );
  await chmod(executable, 0o755);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('Herdr CLI adapter contract', () => {
  test('opens Lumen with exact Herdr CLI calls and inherited child environment', async () => {
    const herdr = createAdapter({ KEEP: 'yes' });

    expect(await herdr.openLumen(pullRequest)).toEqual({ ok: true });

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
        "lumen diff 'https://github.example/acme/widgets/pull/42'; herdr tab focus 'w1:t1'",
      ],
      ['tab', 'focus', 'w1:t9'],
    ]);
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
        'Review Command acme/widgets#42',
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
        `/bin/sh -c 'pi --prompt "Review $REVIEW_PR_URL"'; herdr tab focus 'w1:t1'`,
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

  test('quotes the best-effort Review Queue focus command after the launched command', async () => {
    const herdr = createAdapter({}, undefined, "queue'tab");

    expect(await herdr.openReviewCommand(pullRequest)).toEqual({ ok: true });

    expect((await calls())[1]).toEqual([
      'pane',
      'run',
      'w1:p9',
      `/bin/sh -c 'pi --prompt "Review $REVIEW_PR_URL"'; herdr tab focus 'queue'"'"'tab'`,
    ]);
  });
});

function createAdapter(
  environment: NodeJS.ProcessEnv,
  extraHerdrEnvironment: NodeJS.ProcessEnv = {},
  reviewQueueTabId = 'w1:t1'
) {
  return createHerdrCliAdapter({
    reviewCommand: 'pi --prompt "Review $REVIEW_PR_URL"',
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
