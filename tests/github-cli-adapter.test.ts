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

const completeDetailsJson = {
  ...detailsJson,
  reviews: [
    ...detailsJson.latestReviews,
    {
      author: { login: 'pending-reviewer' },
      state: 'PENDING',
      submittedAt: null,
      body: 'Unsubmitted draft',
    },
  ],
  comments: [
    {
      id: 'IC_kwDO1',
      author: { login: 'commenter' },
      createdAt: '2026-08-21T09:00:00Z',
      body: 'Issue comment body',
    },
  ],
  statusCheckRollup: [
    { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ],
};

const reviewThreadsJson = {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: [
            {
              id: 'PRRT_thread',
              isResolved: true,
              comments: {
                nodes: [
                  {
                    databaseId: 91,
                    author: { login: 'inline-reviewer' },
                    createdAt: '2026-08-21T12:00:00Z',
                    body: 'Inline body',
                    path: 'src/widget.ts',
                    startLine: null,
                    line: null,
                    originalStartLine: 3,
                    originalLine: 5,
                    outdated: true,
                    replyTo: null,
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  },
};

let directory: string;
let originalPath: string | undefined;
let originalMode: string | undefined;
let originalStdout: string | undefined;
let originalStderr: string | undefined;
let originalStatsStdout: string | undefined;
let originalGraphqlStdout: string | undefined;
let originalThreadPageStdout: string | undefined;
let originalCommentPageStdout: string | undefined;
let originalMarker: string | undefined;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'review-gh-'));
  originalPath = process.env.PATH;
  originalMode = process.env.FAKE_GH_MODE;
  originalStdout = process.env.FAKE_GH_STDOUT;
  originalStderr = process.env.FAKE_GH_STDERR;
  originalStatsStdout = process.env.FAKE_GH_STATS_STDOUT;
  originalGraphqlStdout = process.env.FAKE_GH_GRAPHQL_STDOUT;
  originalThreadPageStdout = process.env.FAKE_GH_THREAD_PAGE_STDOUT;
  originalCommentPageStdout = process.env.FAKE_GH_COMMENT_PAGE_STDOUT;
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
const stdout = argv.some((value) => value.startsWith('threadId=')) && process.env.FAKE_GH_COMMENT_PAGE_STDOUT
  ? process.env.FAKE_GH_COMMENT_PAGE_STDOUT
  : argv.some((value) => value.startsWith('threadsCursor=')) && process.env.FAKE_GH_THREAD_PAGE_STDOUT
    ? process.env.FAKE_GH_THREAD_PAGE_STDOUT
    : argv[0] === 'api' && process.env.FAKE_GH_GRAPHQL_STDOUT
      ? process.env.FAKE_GH_GRAPHQL_STDOUT
  : argv[0] === 'pr' && argv[1] === 'view' && process.env.FAKE_GH_STATS_STDOUT
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
  restoreEnvironment('FAKE_GH_GRAPHQL_STDOUT', originalGraphqlStdout);
  restoreEnvironment('FAKE_GH_THREAD_PAGE_STDOUT', originalThreadPageStdout);
  restoreEnvironment('FAKE_GH_COMMENT_PAGE_STDOUT', originalCommentPageStdout);
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

  test('loads independent complete pull request detail sources by canonical URL', async () => {
    process.env.FAKE_GH_STDOUT = JSON.stringify(completeDetailsJson);
    process.env.FAKE_GH_GRAPHQL_STDOUT = JSON.stringify(reviewThreadsJson);
    const github = createGitHubCliAdapter([]);

    const result = await github.loadPullRequestDetails(
      detailsJson.url,
      new AbortController().signal
    );

    expect(result.metadata).toEqual({
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
      },
    });
    expect(result.reviews).toEqual({
      ok: true,
      value: [
        {
          author: 'previous-reviewer',
          state: 'COMMENTED',
          submittedAt: '2026-08-21T10:30:00Z',
          body: 'One concern',
        },
      ],
    });
    expect(result.checks).toEqual({
      ok: true,
      value: [{ name: 'build', state: 'SUCCESS' }],
    });
    expect(result.issueComments).toEqual({
      ok: true,
      value: [
        {
          id: 'IC_kwDO1',
          author: 'commenter',
          createdAt: '2026-08-21T09:00:00Z',
          body: 'Issue comment body',
        },
      ],
    });
    expect(result.inlineComments).toEqual({
      ok: true,
      value: [
        {
          id: '91',
          author: 'inline-reviewer',
          createdAt: '2026-08-21T12:00:00Z',
          body: 'Inline body',
          path: 'src/widget.ts',
          startLine: 3,
          line: 5,
          inReplyToId: null,
          resolved: true,
          outdated: true,
        },
      ],
    });

    const records = await readRecords();
    expect(records).toHaveLength(5);
    expect(records.map((record) => record.argv.slice(0, 4))).toContainEqual([
      'pr',
      'view',
      detailsJson.url,
      '--json',
    ]);
    const graphql = records.find((record) => record.argv[0] === 'api');
    expect(graphql?.argv).not.toContain('--paginate');
    expect(graphql?.argv).not.toContain('--slurp');
    expect(graphql?.argv).toContain('owner=acme');
    expect(graphql?.argv).toContain('repository=widgets');
    expect(graphql?.argv).toContain('number=42');
    expect(graphql?.marker).toBe('inherited');
  });

  test('loads every review-thread and long-thread comment page', async () => {
    const inlineComment = {
      databaseId: 91,
      author: { login: 'inline-reviewer' },
      createdAt: '2026-08-21T12:00:00Z',
      body: 'Inline body',
      path: 'src/widget.ts',
      startLine: 3,
      line: 5,
      originalStartLine: null,
      originalLine: null,
      outdated: false,
      replyTo: null,
    };
    process.env.FAKE_GH_STDOUT = JSON.stringify(completeDetailsJson);
    process.env.FAKE_GH_GRAPHQL_STDOUT = JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  id: 'PRRT_first',
                  isResolved: false,
                  comments: {
                    nodes: [inlineComment],
                    pageInfo: {
                      hasNextPage: true,
                      endCursor: 'comments-next',
                    },
                  },
                },
              ],
              pageInfo: { hasNextPage: true, endCursor: 'threads-next' },
            },
          },
        },
      },
    });
    process.env.FAKE_GH_THREAD_PAGE_STDOUT = JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  id: 'PRRT_second',
                  isResolved: true,
                  comments: {
                    nodes: [{ ...inlineComment, databaseId: 93 }],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    });
    process.env.FAKE_GH_COMMENT_PAGE_STDOUT = JSON.stringify({
      data: {
        node: {
          isResolved: false,
          comments: {
            nodes: [{ ...inlineComment, databaseId: 92 }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    });

    const result = await createGitHubCliAdapter([]).loadPullRequestDetails(
      detailsJson.url,
      new AbortController().signal
    );

    expect(result.inlineComments).toEqual({
      ok: true,
      value: [
        expect.objectContaining({ id: '91', resolved: false }),
        expect.objectContaining({ id: '92', resolved: false }),
        expect.objectContaining({ id: '93', resolved: true }),
      ],
    });
    const graphqlRecords = (await readRecords()).filter(
      (record) => record.argv[0] === 'api'
    );
    expect(graphqlRecords).toHaveLength(3);
    expect(
      graphqlRecords.some((record) =>
        record.argv.includes('threadsCursor=threads-next')
      )
    ).toBe(true);
    expect(
      graphqlRecords.some((record) =>
        record.argv.includes('commentsCursor=comments-next')
      )
    ).toBe(true);
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

  test('keeps independent startup failures on every detail source', async () => {
    process.env.PATH = directory;
    await rm(join(directory, 'gh'));
    const result = await createGitHubCliAdapter([]).loadPullRequestDetails(
      detailsJson.url,
      new AbortController().signal
    );

    const failures = Object.values(result).map(failureOf);
    expect(failures.map((failure) => failure.operation).sort()).toEqual([
      'pullRequestChecks',
      'pullRequestIssueComments',
      'pullRequestMetadata',
      'pullRequestReviewThreads',
      'pullRequestReviews',
    ]);
    for (const failure of failures) {
      expect(failure).toMatchObject({ kind: 'startup', executable: 'gh' });
      expect(diagnosticOf(failure)).toContain('gh');
    }
  });

  test('preserves unsuccessful detail-source diagnostics independently', async () => {
    process.env.FAKE_GH_MODE = '23';
    process.env.FAKE_GH_STDERR = 'authentication failed\ntry gh auth login\n';
    const result = await createGitHubCliAdapter([]).loadPullRequestDetails(
      detailsJson.url,
      new AbortController().signal
    );

    for (const source of Object.values(result)) {
      expect(failureOf(source)).toMatchObject({
        kind: 'exit',
        exitCode: 23,
        stderr: 'authentication failed\ntry gh auth login\n',
        url: detailsJson.url,
      });
    }
  });

  test('reports malformed and incompatible detail-source data without hiding other results', async () => {
    process.env.FAKE_GH_STDOUT = JSON.stringify({
      ...completeDetailsJson,
      labels: [{ color: 'ffffff' }],
    });
    process.env.FAKE_GH_GRAPHQL_STDOUT = JSON.stringify(reviewThreadsJson);
    const result = await createGitHubCliAdapter([]).loadPullRequestDetails(
      detailsJson.url,
      new AbortController().signal
    );

    const metadataFailure = failureOf(result.metadata);
    expect(metadataFailure).toMatchObject({
      kind: 'incompatibleData',
      operation: 'pullRequestMetadata',
    });
    expect(diagnosticOf(metadataFailure)).toContain('$.labels[0].name');
    expect(result.reviews.ok).toBe(true);
    expect(result.checks.ok).toBe(true);
    expect(result.issueComments.ok).toBe(true);
    expect(result.inlineComments.ok).toBe(true);
  });

  test('reports queue malformed data and Review Submission process signals', async () => {
    process.env.FAKE_GH_STDOUT = '{not-json';
    process.env.FAKE_GH_STDERR = 'compatibility warning\n';
    const github = createGitHubCliAdapter([]);
    const malformed = failureOf(
      await github.loadReviewQueue(new AbortController().signal)
    );
    expect(malformed).toMatchObject({
      kind: 'malformedData',
      operation: 'reviewQueue',
      stderr: 'compatibility warning\n',
    });
    expect(diagnosticOf(malformed)).not.toContain('{not-json');

    process.env.FAKE_GH_MODE = 'signal';
    process.env.FAKE_GH_STDERR = 'terminated by host\n';
    const interrupted = failureOf(
      await github.submitReview(
        { url: detailsJson.url, decision: 'comment', message: 'A review' },
        new AbortController().signal
      )
    );
    expect(interrupted).toMatchObject({
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

type ProcessRecord = {
  readonly argv: readonly string[];
  readonly stdin: string;
  readonly marker: string;
};

async function readRecords(): Promise<readonly ProcessRecord[]> {
  const lines = (await readFile(recordPath(), 'utf8')).trim().split('\n');
  return lines.map((line) => {
    const parsed: unknown = JSON.parse(line);
    if (!isProcessRecord(parsed)) throw new Error('invalid fake gh record');
    return parsed;
  });
}

function isProcessRecord(value: unknown): value is ProcessRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'argv' in value &&
    Array.isArray(value.argv) &&
    value.argv.every((argument) => typeof argument === 'string') &&
    'stdin' in value &&
    typeof value.stdin === 'string' &&
    'marker' in value &&
    typeof value.marker === 'string'
  );
}

async function readRecord(): Promise<ProcessRecord | undefined> {
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
