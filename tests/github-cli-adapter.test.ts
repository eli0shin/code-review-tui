import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGitHubCliAdapter } from '../src/github/cli-adapter.ts';
import type { ReviewSubmission } from '../src/domain/pull-request.ts';
import type { GitHubFailure, GitHubResult } from '../src/github/types.ts';

const queueJson = [
  {
    number: 42,
    title: 'Keep exact process data',
    author: { login: 'octocat' },
    isDraft: false,
    state: 'open',
    createdAt: '2026-08-20T10:00:00Z',
    updatedAt: '2026-08-21T11:00:00Z',
    url: 'https://github.example/acme/widgets/pull/42',
    repository: { name: 'widgets', nameWithOwner: 'acme/widgets' },
    labels: [{ name: 'review' }],
    commentsCount: 4,
  },
];

const queueStatsJson = {
  additions: 12,
  deletions: 3,
  changedFiles: 2,
};

const detailsJson = {
  number: 42,
  title: 'Keep exact process data',
  body: 'A body',
  author: { login: 'octocat' },
  state: 'OPEN',
  isDraft: false,
  url: 'https://github.example/acme/widgets/pull/42',
  createdAt: '2026-08-20T10:00:00Z',
  updatedAt: '2026-08-21T11:00:00Z',
  baseRefName: 'main',
  headRefName: 'process-data',
  additions: 12,
  deletions: 3,
  changedFiles: 2,
  labels: [{ name: 'review' }],
  reviewDecision: 'REVIEW_REQUIRED',
  reviewRequests: [{ login: 'reviewer' }, { name: 'maintainers' }],
  latestReviews: [
    {
      author: { login: 'previous-reviewer' },
      state: 'COMMENTED',
      submittedAt: '2026-08-21T10:30:00Z',
      body: 'One concern',
    },
  ],
};

let directory: string;
let originalPath: string | undefined;
let originalMode: string | undefined;
let originalStdout: string | undefined;
let originalStderr: string | undefined;
let originalStatsStdout: string | undefined;
let originalMarker: string | undefined;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'review-gh-'));
  originalPath = process.env.PATH;
  originalMode = process.env.FAKE_GH_MODE;
  originalStdout = process.env.FAKE_GH_STDOUT;
  originalStderr = process.env.FAKE_GH_STDERR;
  originalStatsStdout = process.env.FAKE_GH_STATS_STDOUT;
  originalMarker = process.env.REVIEW_TEST_MARKER;

  const executable = join(directory, 'gh');
  await writeFile(
    executable,
    `#!/usr/bin/env bun
import { appendFileSync, closeSync } from 'node:fs';
const record = process.env.FAKE_GH_RECORD;
let stdin = '';
if (process.env.FAKE_GH_MODE === 'close-input') {
  closeSync(0);
  await Bun.sleep(100);
} else {
  stdin = await Bun.stdin.text();
}
if (process.env.FAKE_GH_STDERR) await Bun.stderr.write(process.env.FAKE_GH_STDERR);
const argv = process.argv.slice(2);
appendFileSync(record, JSON.stringify({
  argv,
  stdin,
  marker: process.env.REVIEW_TEST_MARKER,
}) + '\\n');
if (process.env.FAKE_GH_MODE === 'wait') await Bun.sleep(30_000);
if (process.env.FAKE_GH_MODE === 'signal') process.kill(process.pid, 'SIGTERM');
const stdout = argv[0] === 'pr' && argv[1] === 'view' && process.env.FAKE_GH_STATS_STDOUT
  ? process.env.FAKE_GH_STATS_STDOUT
  : process.env.FAKE_GH_STDOUT;
if (stdout) await Bun.stdout.write(stdout);
process.exit(process.env.FAKE_GH_MODE === 'close-input' ? 29 : Number(process.env.FAKE_GH_MODE || 0));
`
  );
  await chmod(executable, 0o755);
  process.env.PATH = `${directory}:${originalPath ?? ''}`;
  process.env.FAKE_GH_RECORD = join(directory, 'record.json');
  process.env.REVIEW_TEST_MARKER = 'inherited';
});

afterEach(async () => {
  restoreEnvironment('PATH', originalPath);
  restoreEnvironment('FAKE_GH_MODE', originalMode);
  restoreEnvironment('FAKE_GH_STDOUT', originalStdout);
  restoreEnvironment('FAKE_GH_STDERR', originalStderr);
  restoreEnvironment('FAKE_GH_STATS_STDOUT', originalStatsStdout);
  restoreEnvironment('REVIEW_TEST_MARKER', originalMarker);
  delete process.env.FAKE_GH_RECORD;
  await rm(directory, { recursive: true, force: true });
});

describe('GitHub CLI adapter contract', () => {
  test('loads the Review Queue with exact argv, inherited environment, and domain conversion', async () => {
    process.env.FAKE_GH_STDOUT = JSON.stringify(queueJson);
    process.env.FAKE_GH_STATS_STDOUT = JSON.stringify(queueStatsJson);
    const github = createGitHubCliAdapter([
      'review-requested:@me',
      'team:platform reviewers',
    ]);

    const result = await github.loadReviewQueue(new AbortController().signal);

    expect(result).toEqual({
      ok: true,
      value: [
        {
          number: 42,
          title: 'Keep exact process data',
          author: 'octocat',
          isDraft: false,
          state: 'open',
          createdAt: '2026-08-20T10:00:00Z',
          updatedAt: '2026-08-21T11:00:00Z',
          url: 'https://github.example/acme/widgets/pull/42',
          repository: 'acme/widgets',
          additions: 12,
          deletions: 3,
          changedFiles: 2,
          labels: ['review'],
          commentsCount: 4,
        },
      ],
    });
    expect(await readRecords()).toEqual([
      {
        argv: [
          'search',
          'prs',
          '--json',
          'number,title,author,isDraft,state,createdAt,updatedAt,url,repository,labels,commentsCount',
          '--limit',
          '1000',
          '--',
          'review-requested:@me',
          'team:platform reviewers',
        ],
        stdin: '',
        marker: 'inherited',
      },
      {
        argv: [
          'pr',
          'view',
          'https://github.example/acme/widgets/pull/42',
          '--json',
          'additions,deletions,changedFiles',
        ],
        stdin: '',
        marker: 'inherited',
      },
    ]);
  });

  test('loads complete pull request details by canonical URL', async () => {
    process.env.FAKE_GH_STDOUT = JSON.stringify(detailsJson);
    const github = createGitHubCliAdapter([]);

    const result = await github.loadPullRequestDetails(
      detailsJson.url,
      new AbortController().signal
    );

    expect(result).toEqual({
      ok: true,
      value: {
        number: 42,
        title: 'Keep exact process data',
        body: 'A body',
        author: 'octocat',
        state: 'OPEN',
        isDraft: false,
        url: detailsJson.url,
        createdAt: '2026-08-20T10:00:00Z',
        updatedAt: '2026-08-21T11:00:00Z',
        baseRefName: 'main',
        headRefName: 'process-data',
        additions: 12,
        deletions: 3,
        changedFiles: 2,
        labels: ['review'],
        reviewDecision: 'REVIEW_REQUIRED',
        reviewRequests: ['reviewer', 'maintainers'],
        latestReviews: [
          {
            author: 'previous-reviewer',
            state: 'COMMENTED',
            submittedAt: '2026-08-21T10:30:00Z',
            body: 'One concern',
          },
        ],
      },
    });
    expect(await readRecord()).toEqual({
      argv: [
        'pr',
        'view',
        detailsJson.url,
        '--json',
        'number,title,body,author,state,isDraft,url,createdAt,updatedAt,baseRefName,headRefName,additions,deletions,changedFiles,labels,reviewDecision,reviewRequests,latestReviews',
      ],
      stdin: '',
      marker: 'inherited',
    });
  });

  for (const [decision, flag, message] of [
    ['comment', '--comment', 'line one\nline two'],
    ['approve', '--approve', ''],
    ['requestChanges', '--request-changes', 'Please fix this'],
  ] as const) {
    test(`submits ${decision} with exact argv and message stdin`, async () => {
      const github = createGitHubCliAdapter([]);
      const submission = {
        url: detailsJson.url,
        decision,
        message,
      } satisfies ReviewSubmission;

      expect(
        await github.submitReview(submission, new AbortController().signal)
      ).toEqual({ ok: true, value: undefined });
      expect(await readRecord()).toEqual({
        argv: ['pr', 'review', detailsJson.url, flag, '--body-file', '-'],
        stdin: message,
        marker: 'inherited',
      });
    });
  }

  test('reports an operation-specific startup failure with the operating-system diagnostic', async () => {
    process.env.PATH = directory;
    await rm(join(directory, 'gh'));
    const github = createGitHubCliAdapter([]);
    const signal = new AbortController().signal;

    const results = [
      ['reviewQueue', await github.loadReviewQueue(signal)],
      [
        'pullRequestDetails',
        await github.loadPullRequestDetails(detailsJson.url, signal),
      ],
      [
        'reviewSubmission',
        await github.submitReview(
          { url: detailsJson.url, decision: 'approve', message: '' },
          signal
        ),
      ],
    ] as const;

    for (const [operation, result] of results) {
      const failure = failureOf(result);
      expect(failure).toMatchObject({
        kind: 'startup',
        operation,
        executable: 'gh',
      });
      expect(diagnosticOf(failure)).toContain('gh');
    }
  });

  test('preserves unsuccessful exit status and stderr unchanged for each operation', async () => {
    process.env.FAKE_GH_MODE = '23';
    process.env.FAKE_GH_STDERR = 'authentication failed\ntry gh auth login\n';
    const github = createGitHubCliAdapter([]);
    const signal = new AbortController().signal;

    const results = [
      await github.loadReviewQueue(signal),
      await github.loadPullRequestDetails(detailsJson.url, signal),
      await github.submitReview(
        { url: detailsJson.url, decision: 'approve', message: '' },
        signal
      ),
    ];

    for (const result of results) {
      expect(failureOf(result)).toMatchObject({
        kind: 'exit',
        exitCode: 23,
        stderr: 'authentication failed\ntry gh auth login\n',
      });
    }
  });

  test('reports malformed JSON for each data operation without exposing the response', async () => {
    process.env.FAKE_GH_STDOUT = '{not-json';
    process.env.FAKE_GH_STDERR = 'compatibility warning\n';
    const github = createGitHubCliAdapter([]);
    const signal = new AbortController().signal;

    const results = [
      ['reviewQueue', await github.loadReviewQueue(signal)],
      [
        'pullRequestDetails',
        await github.loadPullRequestDetails(detailsJson.url, signal),
      ],
    ] as const;

    for (const [operation, result] of results) {
      const failure = failureOf(result);
      expect(failure).toMatchObject({
        kind: 'malformedData',
        operation,
        stderr: 'compatibility warning\n',
      });
      expect(diagnosticOf(failure)).not.toContain('{not-json');
    }
  });

  for (const [operation, stdout] of [
    ['reviewQueue', JSON.stringify([{ ...queueJson[0], isDraft: 'no' }])],
    [
      'pullRequestDetails',
      JSON.stringify({ ...detailsJson, labels: [{ color: 'ffffff' }] }),
    ],
  ] as const) {
    test(`reports incompatible data with the invalid field for ${operation}`, async () => {
      process.env.FAKE_GH_STDOUT = stdout;
      const github = createGitHubCliAdapter([]);
      const signal = new AbortController().signal;
      const result =
        operation === 'reviewQueue'
          ? await github.loadReviewQueue(signal)
          : await github.loadPullRequestDetails(detailsJson.url, signal);

      const failure = failureOf(result);
      expect(failure).toMatchObject({
        kind: 'incompatibleData',
        operation,
      });
      expect(diagnosticOf(failure)).toContain(
        operation === 'reviewQueue' ? '$[0].isDraft' : '$.labels[0].name'
      );
    });
  }

  test('reports a process signal as an operation-specific interruption', async () => {
    process.env.FAKE_GH_MODE = 'signal';
    process.env.FAKE_GH_STDERR = 'terminated by host\n';
    const github = createGitHubCliAdapter([]);
    const signal = new AbortController().signal;

    const results = [
      await github.loadPullRequestDetails(detailsJson.url, signal),
      await github.submitReview(
        {
          url: detailsJson.url,
          decision: 'comment',
          message: 'A review',
        },
        signal
      ),
    ];

    expect(failureOf(results[0])).toMatchObject({
      kind: 'interrupted',
      operation: 'pullRequestDetails',
      reason: 'signal',
      signal: 'SIGTERM',
      stderr: 'terminated by host\n',
      url: detailsJson.url,
    });
    expect(failureOf(results[1])).toMatchObject({
      kind: 'interrupted',
      operation: 'reviewSubmission',
      reason: 'signal',
      signal: 'SIGTERM',
      stderr: 'terminated by host\n',
      url: detailsJson.url,
    });
  });

  test('consumes a Review Submission stdin error and keeps exit diagnostics', async () => {
    process.env.FAKE_GH_MODE = 'close-input';
    const message = 'review body'.repeat(1_000_000);

    const result = await createGitHubCliAdapter([]).submitReview(
      { url: detailsJson.url, decision: 'comment', message },
      new AbortController().signal
    );

    await Bun.sleep(50);
    expect(failureOf(result)).toMatchObject({
      kind: 'exit',
      operation: 'reviewSubmission',
      exitCode: 29,
      url: detailsJson.url,
    });
  });

  test('reports an abort interruption and preserves stderr', async () => {
    process.env.FAKE_GH_MODE = 'wait';
    process.env.FAKE_GH_STDERR = 'started request\n';
    const controller = new AbortController();
    const promise = createGitHubCliAdapter([]).loadReviewQueue(
      controller.signal
    );
    await waitForRecord();

    controller.abort();
    const result = await promise;

    expect(failureOf(result)).toMatchObject({
      kind: 'interrupted',
      operation: 'reviewQueue',
      reason: 'aborted',
      stderr: 'started request\n',
    });
  });
});

async function readRecords(): Promise<readonly unknown[]> {
  const lines = (await readFile(recordPath(), 'utf8')).trim().split('\n');
  return lines.map((line) => {
    const parsed: unknown = JSON.parse(line);
    return parsed;
  });
}

async function readRecord(): Promise<unknown> {
  const records = await readRecords();
  return records.at(-1);
}

async function waitForRecord(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await readFile(recordPath());
      return;
    } catch {
      await Bun.sleep(10);
    }
  }
  throw new Error('fake gh did not record its invocation');
}

function recordPath(): string {
  const path = process.env.FAKE_GH_RECORD;
  if (path === undefined) throw new Error('fake gh record path is not set');
  return path;
}

function failureOf(result: GitHubResult<unknown>): GitHubFailure {
  if (result.ok) throw new Error('expected GitHub operation to fail');
  return result.failure;
}

function diagnosticOf(failure: GitHubFailure): string {
  if ('diagnostic' in failure && failure.diagnostic !== undefined) {
    return failure.diagnostic;
  }
  throw new Error(`expected ${failure.kind} failure to have a diagnostic`);
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, name);
  else process.env[name] = value;
}
