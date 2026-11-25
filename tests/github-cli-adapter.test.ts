import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
  reviewDecision: 'REVIEW_REQUIRED',
  reviews: [],
  statusCheckRollup: [
    { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ],
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
              diffSide: 'RIGHT',
              startDiffSide: 'RIGHT',
              comments: {
                nodes: [
                  {
                    databaseId: 91,
                    author: { login: 'inline-reviewer' },
                    createdAt: '2026-08-21T12:00:00Z',
                    body: 'Inline body',
                    path: 'src/widget.ts',
                    diffHunk: '@@ -3,3 +3,3 @@\n one\n two\n three',
                    startLine: null,
                    line: null,
                    originalStartLine: 3,
                    originalLine: 5,
                    outdated: true,
                    replyTo: null,
                  },
                  {
                    databaseId: 94,
                    author: null,
                    createdAt: '2026-08-21T12:05:00Z',
                    body: 'Deleted account comment',
                    path: 'src/deleted.ts',
                    diffHunk: '@@ -8 +8 @@\n unchanged',
                    startLine: null,
                    line: 8,
                    originalStartLine: null,
                    originalLine: 8,
                    outdated: false,
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
let originalMarker: string | undefined;
let originalResponses: string | undefined;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'review-gh-'));
  originalPath = process.env.PATH;
  originalMode = process.env.FAKE_GH_MODE;
  originalStdout = process.env.FAKE_GHP_STDOUT;
  originalStderr = process.env.FAKE_GH_STDERR;
  originalMarker = process.env.REVIEW_TEST_MARKER;
  originalResponses = process.env.FAKE_GHP_RESPONSES;

  // One fake serves as gh (browser, Review Submission) and as ghp (reads).
  const fake = `#!/usr/bin/env bun
import { appendFileSync, closeSync } from 'node:fs';
import { basename } from 'node:path';
const bin = basename(process.argv[1]);
let stdin = '';
if (process.env.FAKE_GH_MODE === 'close-input') {
  closeSync(0);
  await Bun.sleep(100);
} else {
  stdin = await Bun.stdin.text();
}
if (process.env.FAKE_GH_STDERR) await Bun.stderr.write(process.env.FAKE_GH_STDERR);
const argv = process.argv.slice(2);
appendFileSync(process.env.FAKE_GH_RECORD, JSON.stringify({ bin, argv, stdin, marker: process.env.REVIEW_TEST_MARKER }) + '\\n');
if (process.env.FAKE_GH_MODE === 'wait') await Bun.sleep(30_000);
if (process.env.FAKE_GH_MODE === 'signal') process.kill(process.pid, 'SIGTERM');
if (bin === 'gh' && argv[0] === 'api' && process.env.FAKE_GH_API_PAGES) {
  // Each page's cursor names the next page's index.
  const pages = JSON.parse(process.env.FAKE_GH_API_PAGES);
  const after = argv.find((value) => value.startsWith('after='));
  await Bun.stdout.write(JSON.stringify(pages[after ? Number(after.slice('after=page-'.length)) : 0]));
}
if (bin === 'ghp' && argv[0] !== 'invalidate') {
  const responses = process.env.FAKE_GHP_RESPONSES ? JSON.parse(process.env.FAKE_GHP_RESPONSES) : [];
  const matched = responses.find(([needle]) => argv.some((value) => value.includes(needle)));
  const stdout = matched ? matched[1] : process.env.FAKE_GHP_STDOUT;
  if (stdout) await Bun.stdout.write(stdout);
  if (matched?.[2]) process.exit(matched[2]);
}
process.exit(process.env.FAKE_GH_MODE === 'close-input' ? 29 : Number(process.env.FAKE_GH_MODE || 0));
`;
  for (const name of ['gh', 'ghp']) {
    await writeFile(join(directory, name), fake);
    await chmod(join(directory, name), 0o755);
  }
  process.env.PATH = `${directory}:${originalPath ?? ''}`;
  process.env.FAKE_GH_RECORD = join(directory, 'record.json');
  process.env.REVIEW_TEST_MARKER = 'inherited';
});

afterEach(async () => {
  restoreEnvironment('PATH', originalPath);
  restoreEnvironment('FAKE_GH_MODE', originalMode);
  restoreEnvironment('FAKE_GHP_STDOUT', originalStdout);
  restoreEnvironment('FAKE_GH_STDERR', originalStderr);
  restoreEnvironment('REVIEW_TEST_MARKER', originalMarker);
  restoreEnvironment('FAKE_GHP_RESPONSES', originalResponses);
  delete process.env.FAKE_GH_RECORD;
  delete process.env.FAKE_GH_API_PAGES;
  await rm(directory, { recursive: true, force: true });
});

describe('GitHub CLI adapter contract', () => {
  test('reads exactly one requested page, with each row’s stats, in one ghp read', async () => {
    const nodes = [42, 43].map((number) =>
      queueNode({
        ...queueJson[0],
        number,
        url: `https://github.example/acme/widgets/pull/${number}`,
        state: 'OPEN',
      })
    );
    process.env.FAKE_GHP_STDOUT = ghpSearch(nodes, 'next-page');
    const result = await createGitHubCliAdapter([
      'is:pr',
      '-label:wip',
      'label:needs review',
    ]).loadReviewQueue(
      new AbortController().signal,
      'reviewQueue',
      undefined,
      undefined,
      { size: 2, after: 'page-start' }
    );
    expect(result.ok && result.value.nextCursor).toBe('next-page');
    expect(
      result.ok && result.value.queue.map((row) => [row.number, row.additions])
    ).toEqual([
      [42, 12],
      [43, 12],
    ]);
    expect(result.ok && result.value.queue[0]?.state).toBe('open');
    const records = await readRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      bin: 'ghp',
      argv: [
        'search',
        '( is:pr -label:wip label:"needs review" ) type:pr',
        '--size',
        '2',
        '--after',
        'page-start',
        '--consumer',
        'review',
      ],
      stdin: '',
      marker: 'inherited',
    });
  });

  test('keeps a page available when a PR author account has been deleted', async () => {
    process.env.FAKE_GHP_STDOUT = ghpSearch([
      queueNode({ ...queueJson[0], author: null }),
    ]);
    const result = await createGitHubCliAdapter(['is:pr']).loadReviewQueue(
      new AbortController().signal
    );
    expect(result).toMatchObject({
      ok: true,
      value: { queue: [{ author: 'ghost', number: 42 }], nextCursor: null },
    });
  });

  test('pulls in Stack layers that match the search and orders each Stack from its top layer down', async () => {
    process.env.FAKE_GHP_RESPONSES = JSON.stringify([
      [
        '(head:',
        ghpSearch([
          stackNode(41, 1, [41, 42, 43, 44]),
          // A prefix match or fork branch with the same name is not a layer.
          searchNode(99),
        ]),
      ],
      [
        'type:pr',
        ghpSearch(
          [
            searchNode(50),
            stackNode(43, 3, [41, 42, 43, 44]),
            searchNode(60),
            stackNode(44, 4, [41, 42, 43, 44]),
          ],
          'next-page'
        ),
      ],
    ]);
    const result = await createGitHubCliAdapter([
      'is:pr',
      'review-requested:@me',
    ]).loadReviewQueue(new AbortController().signal);

    expect(result.ok && result.value.nextCursor).toBe('next-page');
    expect(
      result.ok &&
        result.value.queue.map((row) => [row.number, row.stack?.position])
    ).toEqual([
      [50, undefined],
      [44, 4],
      [43, 3],
      [41, 1],
      [60, undefined],
    ]);
    expect(result.ok && result.value.queue[1]?.stack).toEqual({
      number: 9,
      position: 4,
      size: 4,
    });
    const searches = await searchRecords();
    expect(
      searches.map((record) => [record.argv[1], option(record, '--size')])
    ).toEqual([
      ['( is:pr review-requested:@me ) type:pr', '25'],
      [
        '( is:pr review-requested:@me ) type:pr repo:acme/widgets (head:"layer-41" OR head:"layer-42")',
        '100',
      ],
    ]);
  });

  test('skips pull requests shown on earlier pages and moves past a page that only repeats them', async () => {
    process.env.FAKE_GHP_RESPONSES = JSON.stringify([
      ['(head:', ghpSearch([])],
      ['second-page', ghpSearch([stackNode(42, 2, [41, 42])], 'third-page')],
      ['third-page', ghpSearch([searchNode(70), stackNode(81, 1, [81, 82])])],
    ]);
    const result = await createGitHubCliAdapter(['is:pr']).loadReviewQueue(
      new AbortController().signal,
      'reviewQueue',
      undefined,
      undefined,
      {
        size: 2,
        after: 'second-page',
        excludeUrls: [pullRequestUrl(41), pullRequestUrl(42)],
      }
    );

    expect(result).toMatchObject({
      ok: true,
      value: { queue: [{ number: 70 }, { number: 81 }], nextCursor: null },
    });
    const searches = await searchRecords();
    expect(
      searches.map(
        (record) => option(record, '--after') ?? option(record, '--size')
      )
    ).toEqual(['second-page', 'third-page', '100']);
    expect(searches[2]?.argv[1]).toBe(
      '( is:pr ) type:pr repo:acme/widgets (head:"layer-82")'
    );
  });

  test('reads plain rows from a host without native Stacks', async () => {
    const {
      stack: _stack,
      stackEntry: _stackEntry,
      ...plainNode
    } = searchNode(42);
    process.env.FAKE_GHP_STDOUT = ghpSearch([plainNode], null, false);
    const result = await createGitHubCliAdapter(['is:pr']).loadReviewQueue(
      new AbortController().signal,
      'reviewQueue',
      undefined,
      { nameWithOwner: 'acme/widgets', hostname: 'github.example' }
    );
    expect(result).toMatchObject({
      ok: true,
      value: { queue: [{ number: 42 }] },
    });
    expect(result.ok && result.value.queue[0]).not.toHaveProperty('stack');
    const searches = await searchRecords();
    expect(searches).toHaveLength(1);
    expect(option(searches[0], '--host')).toBe('github.example');
  });

  test('rejects a Stack without the pull request position', async () => {
    process.env.FAKE_GHP_STDOUT = ghpSearch([
      { ...stackNode(42, 2, [41, 42]), stackEntry: null },
    ]);
    const result = await createGitHubCliAdapter(['is:pr']).loadReviewQueue(
      new AbortController().signal
    );
    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: 'incompatibleData',
        diagnostic:
          'GitHub CLI returned incompatible data: $.nodes[0].stackEntry must be an object',
      },
    });
  });

  for (const page of [
    { nodes: [], stacks: true },
    {
      nodes: [],
      pageInfo: { hasNextPage: true, endCursor: null },
      stacks: true,
    },
    { nodes: [], pageInfo: { hasNextPage: true, endCursor: '' }, stacks: true },
    {
      nodes: [null],
      pageInfo: { hasNextPage: false, endCursor: null },
      stacks: true,
    },
    { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
  ]) {
    test(`rejects incompatible page responses: ${JSON.stringify(page)}`, async () => {
      process.env.FAKE_GHP_STDOUT = ghpResult(page);
      const result = await createGitHubCliAdapter(['is:pr']).loadReviewQueue(
        new AbortController().signal
      );
      expect(result).toMatchObject({
        ok: false,
        failure: { kind: 'incompatibleData', operation: 'reviewQueue' },
      });
      expect(await readRecords()).toHaveLength(1);
    });
  }

  test("reports GitHub's error when ghp has no page to serve", async () => {
    process.env.FAKE_GHP_RESPONSES = JSON.stringify([
      [
        'type:pr',
        JSON.stringify({
          value: null,
          fetchedAt: null,
          stale: true,
          error:
            'GitHub graphql requests paused until 2026-11-21T12:00:00.000Z: rate limit exhausted',
        }),
        3,
      ],
    ]);
    const result = await createGitHubCliAdapter(['is:pr']).loadReviewQueue(
      new AbortController().signal
    );
    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: 'exit',
        operation: 'reviewQueue',
        exitCode: 3,
        stderr:
          'GitHub graphql requests paused until 2026-11-21T12:00:00.000Z: rate limit exhausted',
      },
    });
  });

  test('keeps showing a page that failed to refresh', async () => {
    process.env.FAKE_GHP_STDOUT = JSON.stringify({
      value: { nodes: [queueNode()], pageInfo: lastPage, stacks: true },
      fetchedAt: 1,
      stale: true,
      error: 'rate limit exhausted',
    });
    const result = await createGitHubCliAdapter(['is:pr']).loadReviewQueue(
      new AbortController().signal
    );
    expect(result).toMatchObject({
      ok: true,
      value: { queue: [{ number: 42 }] },
    });
  });

  test('an explicit refresh reads past the shared cache', async () => {
    process.env.FAKE_GHP_STDOUT = ghpSearch([queueNode()]);
    const github = createGitHubCliAdapter(['is:pr']);
    await github.loadReviewQueue(new AbortController().signal);
    await github.loadReviewQueue(
      new AbortController().signal,
      'reviewQueue',
      undefined,
      undefined,
      { size: 25, fresh: true }
    );
    const searches = await searchRecords();
    expect(searches.map((record) => option(record, '--max-age'))).toEqual([
      undefined,
      '0',
    ]);
  });

  test('loads the Review Queue with exact argv, inherited environment, and domain conversion', async () => {
    process.env.FAKE_GHP_STDOUT = ghpSearch([queueNode()]);
    const github = createGitHubCliAdapter([
      'review-requested:@me',
      'team:platform reviewers',
    ]);

    const result = await github.loadReviewQueue(new AbortController().signal);

    expect(result).toEqual({
      ok: true,
      value: {
        nextCursor: null,
        queue: [
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
            reviewDecision: 'REVIEW_REQUIRED',
            checks: [{ name: 'build', state: 'SUCCESS' }],
          },
        ],
      },
    });
    expect(await readRecords()).toEqual([
      {
        bin: 'ghp',
        argv: [
          'search',
          '( review-requested:@me team:"platform reviewers" ) type:pr',
          '--size',
          '25',
          '--consumer',
          'review',
        ],
        stdin: '',
        marker: 'inherited',
      },
    ]);
  });

  test("leaves an unscoped search on GitHub CLI's default host", async () => {
    process.env.FAKE_GHP_STDOUT = ghpSearch([queueNode()]);
    await createGitHubCliAdapter(['is:pr']).loadReviewQueue(
      new AbortController().signal
    );
    expect((await searchRecords())[0]?.argv).not.toContain('--host');
  });

  for (const list of ['reviewQueue', 'authored'] as const) {
    test(`${list} replaces an earlier change request with the same reviewer’s later approval`, async () => {
      process.env.FAKE_GHP_STDOUT = ghpSearch([
        queueNode(queueJson[0], {
          ...queueStatsJson,
          reviewDecision: 'CHANGES_REQUESTED',
          reviews: [
            {
              author: { login: 'reviewer' },
              state: 'CHANGES_REQUESTED',
              submittedAt: '2026-08-21T10:00:00Z',
              body: 'Please fix this',
            },
            {
              author: { login: 'reviewer' },
              state: 'APPROVED',
              submittedAt: '2026-08-21T11:00:00Z',
              body: 'Fixed, thanks',
            },
          ],
        }),
      ]);

      const result = await createGitHubCliAdapter([]).loadReviewQueue(
        new AbortController().signal,
        list
      );

      expect(result).toMatchObject({
        ok: true,
        value: { queue: [{ reviewDecision: 'APPROVED' }] },
      });
      expect(await readRecords()).toHaveLength(1);
    });
  }

  test('snapshots configured searches per adapter and keeps session overrides temporary', async () => {
    process.env.FAKE_GHP_STDOUT = ghpSearch([queueNode()]);
    const search = ['is:pr', 'label:original'];
    const github = createGitHubCliAdapter(search);
    search[1] = 'label:changed';
    const anotherGitHub = createGitHubCliAdapter(search);

    expect(
      (await github.loadReviewQueue(new AbortController().signal)).ok
    ).toBe(true);
    expect(
      (
        await github.loadReviewQueue(
          new AbortController().signal,
          'reviewQueue',
          ['is:pr', 'label:session']
        )
      ).ok
    ).toBe(true);
    expect(
      (await github.loadReviewQueue(new AbortController().signal)).ok
    ).toBe(true);
    expect(
      (await anotherGitHub.loadReviewQueue(new AbortController().signal)).ok
    ).toBe(true);
    expect((await searchRecords()).map((record) => record.argv[1])).toEqual([
      '( is:pr label:original ) type:pr',
      '( is:pr label:session ) type:pr',
      '( is:pr label:original ) type:pr',
      '( is:pr label:changed ) type:pr',
    ]);
  });

  test('adds repo scope as a structured qualifier without rewriting raw or Boolean queries', async () => {
    process.env.FAKE_GHP_STDOUT = ghpSearch([queueNode()]);
    const repository = {
      nameWithOwner: 'acme/widgets',
      hostname: 'github.example',
    };
    const queries = [
      ['is:pr', 'repo:other/project', 'repo:ACME/widgets', 'label:review'],
      ['is:pr', '(', 'repo:other/project', 'OR', 'label:bug', ')'],
      ['is:pr', '(', 'repo:acme/widgets', 'OR', 'label:bug', ')'],
    ];
    const github = createGitHubCliAdapter(queries[0]);
    for (const query of queries) {
      const scoped = await github.loadReviewQueue(
        new AbortController().signal,
        'reviewQueue',
        query,
        repository
      );
      expect(scoped.ok && scoped.value.queue.length).toBe(1);
      const last = (await searchRecords()).at(-1);
      expect(last?.argv[1]).toBe(
        `( ${query.join(' ')} ) type:pr repo:acme/widgets`
      );
      expect(option(last, '--host')).toBe('github.example');
    }
    await github.loadReviewQueue(
      new AbortController().signal,
      'authored',
      undefined,
      repository
    );
    expect((await searchRecords()).at(-1)?.argv[1]).toBe(
      '( is:pr author:@me state:open ) type:pr repo:acme/widgets'
    );
    await github.loadReviewQueue(new AbortController().signal);
    expect((await searchRecords()).at(-1)?.argv[1]).toBe(
      `( ${queries[0].join(' ')} ) type:pr`
    );
  });

  test('intersects a repository filter with the intact query and scope, ORing several repositories', async () => {
    process.env.FAKE_GHP_STDOUT = ghpSearch([queueNode()]);
    const github = createGitHubCliAdapter(['is:pr', 'a', 'OR', 'b']);
    await github.loadReviewQueue(
      new AbortController().signal,
      'reviewQueue',
      undefined,
      undefined,
      { size: 25 },
      ['acme/api']
    );
    expect((await searchRecords()).at(-1)?.argv[1]).toBe(
      '( is:pr a OR b ) type:pr repo:acme/api'
    );
    await github.loadReviewQueue(
      new AbortController().signal,
      'authored',
      undefined,
      { nameWithOwner: 'acme/widgets', hostname: 'github.example' },
      { size: 25 },
      ['acme/api', 'other/service']
    );
    expect((await searchRecords()).at(-1)?.argv[1]).toBe(
      '( is:pr author:@me state:open ) type:pr repo:acme/widgets (repo:acme/api OR repo:other/service)'
    );
  });

  test('lists every repository in a search with gh api graphql, following pages and counting pull requests', async () => {
    const page = (names: readonly (string | null)[], next: string | null) => ({
      data: {
        search: {
          nodes: names.map((name) =>
            name === null ? {} : { repository: { nameWithOwner: name } }
          ),
          pageInfo: { hasNextPage: next !== null, endCursor: next },
        },
      },
    });
    process.env.FAKE_GH_API_PAGES = JSON.stringify([
      page(['acme/widgets', 'other/service', null], 'page-1'),
      page(['other/service', 'acme/api', 'other/service'], null),
    ]);
    const github = createGitHubCliAdapter(['is:pr', 'review-requested:@me']);
    const result = await github.loadReviewQueueRepositories(
      new AbortController().signal,
      'reviewQueue',
      undefined,
      { nameWithOwner: 'acme/widgets', hostname: 'github.example' }
    );
    expect(result).toEqual({
      ok: true,
      value: [
        { nameWithOwner: 'other/service', count: 3 },
        { nameWithOwner: 'acme/api', count: 1 },
        { nameWithOwner: 'acme/widgets', count: 1 },
      ],
    });
    const calls = (await readRecords()).filter((record) => record.bin === 'gh');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.argv.slice(0, 4)).toEqual([
      'api',
      'graphql',
      '--hostname',
      'github.example',
    ]);
    expect(calls[0]?.argv).toContain(
      'searchQuery=( is:pr review-requested:@me ) type:pr repo:acme/widgets'
    );
    expect(calls[0]?.argv.some((value) => value.startsWith('after='))).toBe(
      false
    );
    expect(calls[1]?.argv.slice(-2)).toEqual(['-f', 'after=page-1']);

    await github.loadReviewQueueRepositories(
      new AbortController().signal,
      'authored',
      undefined,
      undefined
    );
    const unscoped = (await readRecords()).filter(
      (record) => record.bin === 'gh'
    );
    expect(unscoped[2]?.argv).not.toContain('--hostname');
    expect(unscoped[2]?.argv).toContain(
      'searchQuery=( is:pr author:@me state:open ) type:pr'
    );
  });

  test('reports a failed repository search', async () => {
    process.env.FAKE_GH_MODE = '1';
    process.env.FAKE_GH_STDERR = 'API rate limit exceeded';
    const github = createGitHubCliAdapter(['is:pr']);
    const result = await github.loadReviewQueueRepositories(
      new AbortController().signal,
      'reviewQueue',
      undefined,
      undefined
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected a failure');
    expect(result.failure).toMatchObject({
      kind: 'exit',
      operation: 'reviewQueueRepositories',
      exitCode: 1,
      stderr: 'API rate limit exceeded',
    });
  });

  test('repo scope preserves negative qualifiers and confines the query and results to the resolved host', async () => {
    process.env.FAKE_GHP_STDOUT = ghpSearch([
      queueNode(),
      queueNode({
        ...queueJson[0],
        repository: { nameWithOwner: 'other/project' },
      }),
      queueNode({
        ...queueJson[0],
        url: 'https://github.com/acme/widgets/pull/42',
      }),
    ]);
    const github = createGitHubCliAdapter(['is:pr', '-repo:other/project']);
    const scoped = await github.loadReviewQueue(
      new AbortController().signal,
      'reviewQueue',
      undefined,
      { nameWithOwner: 'acme/widgets', hostname: 'github.example' }
    );
    expect(scoped.ok && scoped.value.queue.length).toBe(1);
    const records = await readRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.argv[1]).toBe(
      '( is:pr -repo:other/project ) type:pr repo:acme/widgets'
    );
    expect(option(records[0], '--host')).toBe('github.example');
  });

  test('searches open PRs authored by the active GitHub user without changing the configured search', async () => {
    process.env.FAKE_GHP_STDOUT = ghpSearch([
      queueNode(queueJson[0], {
        ...queueStatsJson,
        reviewDecision: 'REVIEW_REQUIRED',
        statusCheckRollup: [
          { name: 'build', status: 'COMPLETED', conclusion: 'FAILURE' },
        ],
      }),
    ]);
    const github = createGitHubCliAdapter([
      'review-requested:@me',
      'state:open',
    ]);

    const authored = await github.loadReviewQueue(
      new AbortController().signal,
      'authored'
    );
    expect(authored).toMatchObject({
      ok: true,
      value: {
        queue: [
          {
            reviewDecision: 'REVIEW_REQUIRED',
            checks: [{ name: 'build', state: 'FAILURE' }],
          },
        ],
      },
    });
    const queue = await github.loadReviewQueue(new AbortController().signal);
    expect(queue).toMatchObject({
      ok: true,
      value: {
        queue: [
          {
            reviewDecision: 'REVIEW_REQUIRED',
            checks: [{ name: 'build', state: 'FAILURE' }],
          },
        ],
      },
    });
    expect((await readRecords()).map((record) => record.argv[1])).toEqual([
      '( is:pr author:@me state:open ) type:pr',
      '( review-requested:@me state:open ) type:pr',
    ]);
  });

  test('shows only the latest run of each check', async () => {
    process.env.FAKE_GHP_STDOUT = ghpDetails({
      statusCheckRollup: [
        {
          name: 'lint',
          workflowName: 'Hygiene',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
          startedAt: '2026-08-21T10:00:00Z',
        },
        {
          name: 'lint',
          workflowName: 'Release',
          status: 'COMPLETED',
          conclusion: 'SKIPPED',
          startedAt: '2026-08-21T09:00:00Z',
        },
        {
          name: 'lint',
          workflowName: 'Hygiene',
          status: 'COMPLETED',
          conclusion: 'SUCCESS',
          startedAt: '2026-08-21T11:00:00Z',
        },
        {
          name: 'lint',
          workflowName: 'Hygiene',
          status: 'COMPLETED',
          conclusion: 'CANCELLED',
          startedAt: '2026-08-21T10:30:00Z',
        },
        {
          name: 'e2e',
          workflowName: 'Hygiene',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
          startedAt: '2026-08-21T10:00:00Z',
        },
        {
          name: 'e2e',
          workflowName: 'Hygiene',
          status: 'QUEUED',
          conclusion: '',
          startedAt: '0001-01-01T00:00:00Z',
        },
        {
          context: 'deploy',
          state: 'FAILURE',
          startedAt: '2026-08-21T10:00:00Z',
        },
        {
          context: 'deploy',
          state: 'SUCCESS',
          startedAt: '2026-08-21T12:00:00Z',
        },
      ],
    });

    const result = await createGitHubCliAdapter([]).loadPullRequestDetails(
      detailsJson.url,
      new AbortController().signal
    );

    expect(result.checks).toEqual({
      ok: true,
      value: [
        { workflow: 'Hygiene', name: 'lint', state: 'SUCCESS' },
        { workflow: 'Release', name: 'lint', state: 'SKIPPED' },
        { workflow: 'Hygiene', name: 'e2e', state: 'QUEUED' },
        { name: 'deploy', state: 'SUCCESS' },
      ],
    });
  });

  test('loads every pull request detail source from one ghp read by canonical URL', async () => {
    process.env.FAKE_GHP_STDOUT = ghpDetails();
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
          threadId: 'PRRT_thread',
          author: 'inline-reviewer',
          createdAt: '2026-08-21T12:00:00Z',
          body: 'Inline body',
          path: 'src/widget.ts',
          source: {
            diffHunk: '@@ -3,3 +3,3 @@\n one\n two\n three',
            side: 'RIGHT',
            startSide: 'RIGHT',
            line: 5,
            startLine: 3,
          },
          startLine: 3,
          line: 5,
          inReplyToId: null,
          resolved: true,
          outdated: true,
        },
        {
          id: '94',
          threadId: 'PRRT_thread',
          author: 'ghost',
          createdAt: '2026-08-21T12:05:00Z',
          body: 'Deleted account comment',
          path: 'src/deleted.ts',
          source: {
            diffHunk: '@@ -8 +8 @@\n unchanged',
            side: 'RIGHT',
            startSide: 'RIGHT',
            line: 8,
            startLine: null,
          },
          startLine: null,
          line: 8,
          inReplyToId: null,
          resolved: true,
          outdated: false,
        },
      ],
    });

    expect(await readRecords()).toEqual([
      {
        bin: 'ghp',
        argv: ['pr', 'details', detailsJson.url, '--consumer', 'review'],
        stdin: '',
        marker: 'inherited',
      },
    ]);
  });

  test('an explicit details refresh reads past the shared cache', async () => {
    process.env.FAKE_GHP_STDOUT = ghpDetails();
    await createGitHubCliAdapter([]).loadPullRequestDetails(
      detailsJson.url,
      new AbortController().signal,
      { fresh: true }
    );
    expect((await readRecord())?.argv).toEqual([
      'pr',
      'details',
      detailsJson.url,
      '--max-age',
      '0',
      '--consumer',
      'review',
    ]);
  });

  test('reads every review thread with all of its comments in order', async () => {
    const inlineComment = {
      databaseId: 91,
      author: { login: 'inline-reviewer' },
      createdAt: '2026-08-21T12:00:00Z',
      body: 'Inline body',
      path: 'src/widget.ts',
      diffHunk: '@@ -3,3 +3,3 @@\n one\n two\n three',
      startLine: 3,
      line: 5,
      originalStartLine: null,
      originalLine: null,
      outdated: false,
      replyTo: null,
    };
    process.env.FAKE_GHP_STDOUT = ghpDetails({
      reviewThreads: [
        {
          id: 'PRRT_first',
          isResolved: false,
          diffSide: 'LEFT',
          startDiffSide: 'LEFT',
          comments: [inlineComment, { ...inlineComment, databaseId: 92 }],
        },
        {
          id: 'PRRT_second',
          isResolved: true,
          diffSide: 'RIGHT',
          startDiffSide: null,
          comments: [{ ...inlineComment, databaseId: 93 }],
        },
      ],
    });

    const result = await createGitHubCliAdapter([]).loadPullRequestDetails(
      detailsJson.url,
      new AbortController().signal
    );

    expect(result.inlineComments).toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          id: '91',
          threadId: 'PRRT_first',
          resolved: false,
          source: {
            diffHunk: inlineComment.diffHunk,
            side: 'LEFT',
            startSide: 'LEFT',
            line: 5,
            startLine: 3,
          },
        }),
        expect.objectContaining({
          id: '92',
          threadId: 'PRRT_first',
          resolved: false,
        }),
        expect.objectContaining({
          id: '93',
          threadId: 'PRRT_second',
          resolved: true,
          source: {
            diffHunk: inlineComment.diffHunk,
            side: 'RIGHT',
            startSide: null,
            line: 5,
            startLine: 3,
          },
        }),
      ],
    });
  });

  test('keeps original hunk coordinates distinct from shifted current comment ranges', async () => {
    process.env.FAKE_GHP_STDOUT = JSON.stringify(
      JSON.parse(ghpDetails()),
      (key, value: unknown) => {
        if (key === 'line') return 50;
        if (key === 'startLine') return 48;
        if (key === 'originalLine') return 47;
        if (key === 'originalStartLine') return null;
        return value;
      }
    );
    const result = await createGitHubCliAdapter([]).loadPullRequestDetails(
      detailsJson.url,
      new AbortController().signal
    );
    expect(result.inlineComments.ok).toBe(true);
    if (!result.inlineComments.ok) throw new Error('Expected inline comments');
    expect(
      result.inlineComments.value.map((comment) => ({
        line: comment.line,
        startLine: comment.startLine,
        sourceLine: comment.source?.line,
        sourceStartLine: comment.source?.startLine,
      }))
    ).toEqual([
      { line: 50, startLine: 48, sourceLine: 47, sourceStartLine: null },
      { line: 50, startLine: 48, sourceLine: 47, sourceStartLine: null },
    ]);
  });

  test('opens a canonical pull request URL in the default browser', async () => {
    const result = await createGitHubCliAdapter([]).openPullRequestInBrowser(
      detailsJson.url,
      new AbortController().signal
    );

    expect(result).toEqual({ ok: true, value: undefined });
    expect(await readRecord()).toEqual({
      bin: 'gh',
      argv: ['pr', 'view', detailsJson.url, '--web'],
      stdin: '',
      marker: 'inherited',
    });
  });

  for (const [decision, flag, message] of [
    ['comment', '--comment', 'line one\nline two'],
    ['approve', '--approve', ''],
    ['requestChanges', '--request-changes', 'Please fix this'],
  ] as const) {
    test(`submits ${decision} with exact argv and message stdin, then marks the cached pull request stale`, async () => {
      const github = createGitHubCliAdapter([]);
      const submission = {
        url: detailsJson.url,
        decision,
        message,
      } satisfies ReviewSubmission;

      expect(
        await github.submitReview(submission, new AbortController().signal)
      ).toEqual({ ok: true, value: undefined });
      expect(await readRecords()).toEqual([
        {
          bin: 'gh',
          argv: ['pr', 'review', detailsJson.url, flag, '--body-file', '-'],
          stdin: message,
          marker: 'inherited',
        },
        {
          bin: 'ghp',
          argv: ['invalidate', detailsJson.url, '--consumer', 'review'],
          stdin: '',
          marker: 'inherited',
        },
      ]);
    });
  }

  test('a submitted review succeeds even when ghp is missing', async () => {
    await rm(join(directory, 'ghp'));
    // Keep Bun for the fake gh, without any installed ghp.
    process.env.PATH = `${directory}:${dirname(process.execPath)}`;
    expect(
      await createGitHubCliAdapter([]).submitReview(
        { url: detailsJson.url, decision: 'approve', message: '' },
        new AbortController().signal
      )
    ).toEqual({ ok: true, value: undefined });
  });

  test('keeps independent startup failures on every detail source', async () => {
    process.env.PATH = directory;
    await rm(join(directory, 'ghp'));
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
      expect(failure).toMatchObject({ kind: 'startup', executable: 'ghp' });
      expect(diagnosticOf(failure)).toContain('ghp');
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
    process.env.FAKE_GHP_STDOUT = ghpDetails({
      metadata: { ...detailsMetadata(), labels: [{ color: 'ffffff' }] },
    });
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
    process.env.FAKE_GHP_STDOUT = '{not-json';
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

const lastPage = { hasNextPage: false, endCursor: null };

function ghpResult(value: unknown): string {
  return JSON.stringify({ value, fetchedAt: 1, stale: false, error: null });
}

// A `ghp search` page: GitHub search nodes with each row's stats.
function ghpSearch(
  nodes: readonly unknown[],
  endCursor: string | null = null,
  stacks = true
): string {
  return ghpResult({
    nodes: nodes.map((node) =>
      node !== null && typeof node === 'object'
        ? { ...queueStatsJson, ...node }
        : node
    ),
    pageInfo: { hasNextPage: endCursor !== null, endCursor },
    stacks,
  });
}

// A search node from a gh search fixture row, with its stats.
function queueNode(
  item: Record<string, unknown> = queueJson[0],
  stats: Record<string, unknown> = queueStatsJson
) {
  const { labels, commentsCount, ...rest } = item;
  return {
    ...rest,
    labels: { nodes: labels ?? [] },
    comments: { totalCount: commentsCount ?? 0 },
    stack: null,
    stackEntry: null,
    ...stats,
  };
}

function detailsMetadata(): Record<string, unknown> {
  const { latestReviews: _latestReviews, ...metadata } = detailsJson;
  return metadata;
}

// A `ghp pr details` value: gh pr view shapes plus every review thread.
function ghpDetails(overrides: Record<string, unknown> = {}): string {
  return ghpResult({
    metadata: detailsMetadata(),
    reviews: completeDetailsJson.reviews,
    statusCheckRollup: completeDetailsJson.statusCheckRollup,
    comments: completeDetailsJson.comments,
    reviewThreads:
      reviewThreadsJson.data.repository.pullRequest.reviewThreads.nodes.map(
        (thread) => ({ ...thread, comments: thread.comments.nodes })
      ),
    ...overrides,
  });
}

async function searchRecords(): Promise<readonly ProcessRecord[]> {
  return (await readRecords()).filter(
    (record) => record.bin === 'ghp' && record.argv[0] === 'search'
  );
}

function option(
  record: ProcessRecord | undefined,
  name: string
): string | undefined {
  const index = record?.argv.indexOf(name) ?? -1;
  return index < 0 ? undefined : record?.argv[index + 1];
}

function pullRequestUrl(number: number): string {
  return `https://github.example/acme/widgets/pull/${number}`;
}

function searchNode(number: number) {
  return {
    ...queueJson[0],
    number,
    url: pullRequestUrl(number),
    labels: { nodes: [] },
    comments: { totalCount: 0 },
    stack: null,
    stackEntry: null,
  };
}

function stackNode(
  number: number,
  position: number,
  layers: readonly number[]
) {
  return {
    ...searchNode(number),
    stack: {
      number: 9,
      size: layers.length,
      entries: {
        nodes: [
          ...layers.map((layer) => ({
            pullRequest: {
              url: pullRequestUrl(layer),
              headRefName: `layer-${layer}`,
            },
          })),
          // GitHub returns null for a layer the viewer cannot read.
          { pullRequest: null },
        ],
      },
    },
    stackEntry: { position },
  };
}

type ProcessRecord = {
  readonly bin: 'gh' | 'ghp';
  readonly argv: readonly string[];
  readonly stdin: string;
  readonly marker: string;
};

async function readRecords(): Promise<readonly ProcessRecord[]> {
  const lines = (await readFile(recordPath(), 'utf8')).trim().split('\n');
  return lines.map((line) => {
    const parsed: unknown = JSON.parse(line);
    if (!isProcessRecord(parsed)) throw new Error('invalid fake record');
    return parsed;
  });
}

function isProcessRecord(value: unknown): value is ProcessRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'bin' in value &&
    (value.bin === 'gh' || value.bin === 'ghp') &&
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
