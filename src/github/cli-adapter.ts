import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  PullRequestCheck,
  PullRequestDetails,
  PullRequestInlineComment,
  PullRequestIssueComment,
  PullRequestReview,
  PullRequestSummary,
  ReviewDecision,
  ReviewQueue,
} from '../domain/pull-request.ts';
import type {
  GitHub,
  GitHubFailure,
  GitHubOperation,
  GitHubResult,
} from './types.ts';

const queueFields =
  'number,title,author,isDraft,state,createdAt,updatedAt,url,repository,labels,commentsCount';
const queueStatsFields = 'additions,deletions,changedFiles';
const queueEnrichmentConcurrency = 8;
const detailFields =
  'number,title,body,author,state,isDraft,url,createdAt,updatedAt,baseRefName,headRefName,additions,deletions,changedFiles,labels,reviewDecision,reviewRequests';
const reviewThreadQuery = `
query($owner:String!,$repository:String!,$number:Int!,$threadsCursor:String) {
  repository(owner:$owner,name:$repository) {
    pullRequest(number:$number) {
      reviewThreads(first:100,after:$threadsCursor) {
        nodes {
          id
          isResolved
          comments(first:100) {
            nodes {
              databaseId
              author { login }
              createdAt
              body
              path
              line
              startLine
              originalLine
              originalStartLine
              outdated
              replyTo { databaseId }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;
const reviewThreadCommentsQuery = `
query($threadId:ID!,$commentsCursor:String) {
  node(id:$threadId) {
    ... on PullRequestReviewThread {
      isResolved
      comments(first:100,after:$commentsCursor) {
        nodes {
          databaseId
          author { login }
          createdAt
          body
          path
          line
          startLine
          originalLine
          originalStartLine
          outdated
          replyTo { databaseId }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

export function createGitHubCliAdapter(search: readonly string[]): GitHub {
  const searchArguments = [...search];

  return {
    async loadReviewQueue(signal) {
      const processResult = await runGh(
        [
          'search',
          'prs',
          '--json',
          queueFields,
          '--limit',
          '1000',
          '--',
          ...searchArguments,
        ],
        '',
        'reviewQueue',
        undefined,
        signal
      );
      if (!processResult.ok) return processResult;
      const parsed = parseOutput(
        processResult.value,
        'reviewQueue',
        parseReviewQueue
      );
      if (!parsed.ok) return parsed;
      return enrichReviewQueue(parsed.value, signal);
    },

    async loadPullRequestDetails(url, signal) {
      const [metadata, reviews, checks, issueComments, inlineComments] =
        await Promise.all([
          loadDetailSource(
            ['pr', 'view', url, '--json', detailFields],
            'pullRequestMetadata',
            url,
            signal,
            parsePullRequestDetails
          ),
          loadDetailSource(
            ['pr', 'view', url, '--json', 'reviews'],
            'pullRequestReviews',
            url,
            signal,
            parseReviews
          ),
          loadDetailSource(
            ['pr', 'view', url, '--json', 'statusCheckRollup'],
            'pullRequestChecks',
            url,
            signal,
            parseChecks
          ),
          loadDetailSource(
            ['pr', 'view', url, '--json', 'comments'],
            'pullRequestIssueComments',
            url,
            signal,
            parseIssueComments
          ),
          loadInlineComments(url, signal),
        ]);
      return { metadata, reviews, checks, issueComments, inlineComments };
    },

    async openPullRequestInBrowser(url, signal) {
      return runGh(
        ['pr', 'view', url, '--web'],
        '',
        'openPullRequestInBrowser',
        url,
        signal
      ).then((result): GitHubResult<void> =>
        result.ok ? { ok: true, value: undefined } : result
      );
    },

    async submitReview(submission, signal) {
      return runGh(
        [
          'pr',
          'review',
          submission.url,
          decisionFlag(submission.decision),
          '--body-file',
          '-',
        ],
        submission.message,
        'reviewSubmission',
        submission.url,
        signal
      ).then((result): GitHubResult<void> =>
        result.ok ? { ok: true, value: undefined } : result
      );
    },
  };
}

async function loadDetailSource<Value>(
  arguments_: readonly string[],
  operation: GitHubOperation,
  url: string,
  signal: AbortSignal,
  parse: (value: unknown) => Value
): Promise<GitHubResult<Value>> {
  const processResult = await runGh(arguments_, '', operation, url, signal);
  if (!processResult.ok) return processResult;
  return parseOutput(processResult.value, operation, parse, url);
}

async function loadInlineComments(
  url: string,
  signal: AbortSignal
): Promise<GitHubResult<readonly PullRequestInlineComment[]>> {
  const targetResult = parsePullRequestUrlResult(url);
  if (!targetResult.ok) {
    return failure({
      kind: 'incompatibleData',
      operation: 'pullRequestReviewThreads',
      url,
      diagnostic: targetResult.diagnostic,
      stderr: '',
    });
  }
  const target = targetResult.value;
  const comments: PullRequestInlineComment[] = [];
  let threadsCursor: string | null = null;
  do {
    const threadPage: GitHubResult<ReviewThreadPage> = await loadDetailSource(
      [
        'api',
        'graphql',
        '--hostname',
        target.hostname,
        '-f',
        `query=${reviewThreadQuery}`,
        '-F',
        `owner=${target.owner}`,
        '-F',
        `repository=${target.repository}`,
        '-F',
        `number=${target.number}`,
        ...(threadsCursor === null
          ? []
          : (['-f', `threadsCursor=${threadsCursor}`] as const)),
      ],
      'pullRequestReviewThreads',
      url,
      signal,
      parseReviewThreadPage
    );
    if (!threadPage.ok) return threadPage;
    comments.push(...threadPage.value.comments);
    threadsCursor = threadPage.value.nextCursor;

    for (const continuation of threadPage.value.continuations) {
      let commentsCursor: string | null = continuation.nextCursor;
      while (commentsCursor !== null) {
        const commentPage: GitHubResult<{
          readonly comments: readonly PullRequestInlineComment[];
          readonly nextCursor: string | null;
        }> = await loadDetailSource(
          [
            'api',
            'graphql',
            '--hostname',
            target.hostname,
            '-f',
            `query=${reviewThreadCommentsQuery}`,
            '-F',
            `threadId=${continuation.threadId}`,
            '-f',
            `commentsCursor=${commentsCursor}`,
          ],
          'pullRequestReviewThreads',
          url,
          signal,
          parseReviewThreadCommentPage
        );
        if (!commentPage.ok) return commentPage;
        comments.push(...commentPage.value.comments);
        commentsCursor = commentPage.value.nextCursor;
      }
    }
  } while (threadsCursor !== null);

  return { ok: true, value: comments };
}

function parsePullRequestUrlResult(url: string):
  | {
      readonly ok: true;
      readonly value: ReturnType<typeof parsePullRequestUrl>;
    }
  | { readonly ok: false; readonly diagnostic: string } {
  try {
    return { ok: true, value: parsePullRequestUrl(url) };
  } catch (error) {
    return { ok: false, diagnostic: describeError(error) };
  }
}

function parsePullRequestUrl(url: string): {
  readonly hostname: string;
  readonly owner: string;
  readonly repository: string;
  readonly number: number;
} {
  const target = new URL(url);
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/.exec(target.pathname);
  if (match === null) {
    throw new CompatibilityError(
      'Pull request URL must contain an owner, repository, and pull request number'
    );
  }
  return {
    hostname: target.hostname,
    owner: decodeURIComponent(match[1]),
    repository: decodeURIComponent(match[2]),
    number: Number(match[3]),
  };
}

type ProcessOutput = {
  readonly stdout: string;
  readonly stderr: string;
};

async function runGh(
  arguments_: readonly string[],
  stdin: string,
  operation: GitHubOperation,
  url: string | undefined,
  signal: AbortSignal
): Promise<GitHubResult<ProcessOutput>> {
  if (signal.aborted) {
    return failure({
      kind: 'interrupted',
      operation,
      ...(url === undefined ? {} : { url }),
      reason: 'aborted',
      stderr: '',
    });
  }

  const subprocess = spawn('gh', [...arguments_], {
    env: process.env,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const state = createProcessState();

  subprocess.stdout.setEncoding('utf8');
  subprocess.stderr.setEncoding('utf8');
  subprocess.stdout.on('data', (chunk: string) => {
    state.stdout += chunk;
  });
  subprocess.stderr.on('data', (chunk: string) => {
    state.stderr += chunk;
  });
  const abort = (): void => {
    state.aborted = true;
    subprocess.kill('SIGTERM');
  };
  signal.addEventListener('abort', abort, { once: true });
  const inputSettled = sendInput(subprocess, state, stdin);

  const outcome = await new Promise<
    | { readonly kind: 'error'; readonly diagnostic: string }
    | {
        readonly kind: 'close';
        readonly exitCode: number | null;
        readonly signal: NodeJS.Signals | null;
      }
  >((resolve) => {
    subprocess.once('error', (error) => {
      resolve({ kind: 'error', diagnostic: describeError(error) });
    });
    subprocess.once('close', (exitCode, processSignal) => {
      resolve({ kind: 'close', exitCode, signal: processSignal });
    });
  });
  signal.removeEventListener('abort', abort);
  await inputSettled;

  if (outcome.kind === 'error') {
    return failure({
      kind: 'startup',
      operation,
      ...(url === undefined ? {} : { url }),
      executable: 'gh',
      diagnostic: outcome.diagnostic,
    });
  }
  if (state.aborted) {
    return failure({
      kind: 'interrupted',
      operation,
      ...(url === undefined ? {} : { url }),
      reason: 'aborted',
      stderr: state.stderr,
    });
  }
  if (outcome.signal !== null) {
    return failure({
      kind: 'interrupted',
      operation,
      ...(url === undefined ? {} : { url }),
      reason: 'signal',
      signal: outcome.signal,
      stderr: state.stderr,
    });
  }
  if (outcome.exitCode !== 0) {
    return failure({
      kind: 'exit',
      operation,
      ...(url === undefined ? {} : { url }),
      exitCode: outcome.exitCode ?? -1,
      stderr: state.stderr,
    });
  }
  if (state.inputDiagnostic !== undefined) {
    return failure({
      kind: 'interrupted',
      operation,
      ...(url === undefined ? {} : { url }),
      reason: 'io',
      diagnostic: state.inputDiagnostic,
      stderr: state.stderr,
    });
  }

  return {
    ok: true,
    value: { stdout: state.stdout, stderr: state.stderr },
  };
}

type ProcessState = {
  aborted: boolean;
  inputDiagnostic?: string;
  stderr: string;
  stdout: string;
};

function sendInput(
  subprocess: ChildProcessWithoutNullStreams,
  state: ProcessState,
  input: string
): Promise<undefined> {
  return new Promise((resolve) => {
    subprocess.stdin.on('error', (error) => {
      state.inputDiagnostic ??= describeError(error);
      resolve(undefined);
    });
    try {
      subprocess.stdin.end(input, 'utf8', () => {
        queueMicrotask(() => resolve(undefined));
      });
    } catch (error) {
      state.inputDiagnostic = describeError(error);
      resolve(undefined);
    }
  });
}

function createProcessState(): ProcessState {
  return { aborted: false, stderr: '', stdout: '' };
}

function parseOutput<Value>(
  output: ProcessOutput,
  operation: GitHubOperation,
  parse: (value: unknown) => Value,
  url?: string
): GitHubResult<Value> {
  const parsed = parseJson(output, operation, url);
  if (!parsed.ok) return parsed;
  return validateJson(parsed.value, output.stderr, operation, parse, url);
}

function parseJson(
  output: ProcessOutput,
  operation: GitHubOperation,
  url?: string
): GitHubResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(output.stdout) };
  } catch (error) {
    return failure({
      kind: 'malformedData',
      operation,
      ...(url === undefined ? {} : { url }),
      diagnostic: `GitHub CLI returned malformed JSON: ${describeError(error)}`,
      stderr: output.stderr,
    });
  }
}

function validateJson<Value>(
  value: unknown,
  stderr: string,
  operation: GitHubOperation,
  parse: (value: unknown) => Value,
  url?: string
): GitHubResult<Value> {
  try {
    return { ok: true, value: parse(value) };
  } catch (error) {
    const diagnostic =
      error instanceof CompatibilityError
        ? error.message
        : `GitHub CLI returned incompatible data: ${describeError(error)}`;
    return failure({
      kind: 'incompatibleData',
      operation,
      ...(url === undefined ? {} : { url }),
      diagnostic,
      stderr,
    });
  }
}

async function enrichReviewQueue(
  queue: ReviewQueue,
  signal: AbortSignal
): Promise<GitHubResult<ReviewQueue>> {
  const enriched: PullRequestSummary[] = [];
  for (
    let offset = 0;
    offset < queue.length;
    offset += queueEnrichmentConcurrency
  ) {
    const batch = queue.slice(offset, offset + queueEnrichmentConcurrency);
    const results = await Promise.all(batch.map(loadSummaryStats));
    const failureResult = results.find((result) => !result.ok);
    if (failureResult !== undefined) return failureResult;
    enriched.push(
      ...results.flatMap((result) => (result.ok ? [result.value] : []))
    );
  }
  return { ok: true, value: enriched };

  async function loadSummaryStats(
    pullRequest: PullRequestSummary
  ): Promise<GitHubResult<PullRequestSummary>> {
    const processResult = await runGh(
      ['pr', 'view', pullRequest.url, '--json', queueStatsFields],
      '',
      'reviewQueue',
      undefined,
      signal
    );
    if (!processResult.ok) return processResult;
    return parseOutput(processResult.value, 'reviewQueue', (value) =>
      addSummaryStats(pullRequest, value)
    );
  }
}

function addSummaryStats(
  pullRequest: PullRequestSummary,
  value: unknown
): PullRequestSummary {
  const stats = record(value, '$');
  return {
    ...pullRequest,
    additions: integer(stats.additions, '$.additions'),
    deletions: integer(stats.deletions, '$.deletions'),
    changedFiles: integer(stats.changedFiles, '$.changedFiles'),
  };
}

function parseReviewQueue(value: unknown): ReviewQueue {
  const items = array(value, '$');
  return items.map((item, index) => parseSummary(item, `$[${index}]`));
}

function parseSummary(value: unknown, path: string): PullRequestSummary {
  const item = record(value, path);
  const author = record(item.author, `${path}.author`);
  const repository = record(item.repository, `${path}.repository`);
  return {
    number: integer(item.number, `${path}.number`),
    title: string(item.title, `${path}.title`),
    author: string(author.login, `${path}.author.login`),
    isDraft: boolean(item.isDraft, `${path}.isDraft`),
    state: string(item.state, `${path}.state`),
    createdAt: string(item.createdAt, `${path}.createdAt`),
    updatedAt: string(item.updatedAt, `${path}.updatedAt`),
    url: string(item.url, `${path}.url`),
    repository: string(
      repository.nameWithOwner,
      `${path}.repository.nameWithOwner`
    ),
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    labels: array(item.labels, `${path}.labels`).map((label, index) => {
      const labelValue = record(label, `${path}.labels[${index}]`);
      return string(labelValue.name, `${path}.labels[${index}].name`);
    }),
    commentsCount: integer(item.commentsCount, `${path}.commentsCount`),
  };
}

function parsePullRequestDetails(value: unknown): PullRequestDetails {
  const item = record(value, '$');
  const author = record(item.author, '$.author');
  return {
    number: integer(item.number, '$.number'),
    title: string(item.title, '$.title'),
    body: string(item.body, '$.body'),
    author: string(author.login, '$.author.login'),
    state: string(item.state, '$.state'),
    isDraft: boolean(item.isDraft, '$.isDraft'),
    url: string(item.url, '$.url'),
    createdAt: string(item.createdAt, '$.createdAt'),
    updatedAt: string(item.updatedAt, '$.updatedAt'),
    baseRefName: string(item.baseRefName, '$.baseRefName'),
    headRefName: string(item.headRefName, '$.headRefName'),
    additions: integer(item.additions, '$.additions'),
    deletions: integer(item.deletions, '$.deletions'),
    changedFiles: integer(item.changedFiles, '$.changedFiles'),
    labels: array(item.labels, '$.labels').map((label, index) => {
      const labelValue = record(label, `$.labels[${index}]`);
      return string(labelValue.name, `$.labels[${index}].name`);
    }),
    reviewDecision: string(item.reviewDecision, '$.reviewDecision'),
    reviewRequests: array(item.reviewRequests, '$.reviewRequests').map(
      parseReviewRequest
    ),
  };
}

function parseReviews(value: unknown): readonly PullRequestReview[] {
  const item = record(value, '$');
  return array(item.reviews, '$.reviews').flatMap((reviewValue, index) => {
    const path = `$.reviews[${index}]`;
    const review = record(reviewValue, path);
    if (string(review.state, `${path}.state`) === 'PENDING') return [];
    return [parseReview(reviewValue, index, '$.reviews')];
  });
}

function parseChecks(value: unknown): readonly PullRequestCheck[] {
  const item = record(value, '$');
  return array(item.statusCheckRollup, '$.statusCheckRollup').map(
    (value, index) => {
      const path = `$.statusCheckRollup[${index}]`;
      const check = record(value, path);
      const name =
        typeof check.name === 'string'
          ? check.name
          : string(check.context, `${path}.context`);
      const state =
        typeof check.conclusion === 'string' && check.conclusion !== ''
          ? check.conclusion
          : typeof check.state === 'string'
            ? check.state
            : string(check.status, `${path}.status`);
      return { name, state };
    }
  );
}

function parseIssueComments(
  value: unknown
): readonly PullRequestIssueComment[] {
  const item = record(value, '$');
  return array(item.comments, '$.comments').map((value, index) => {
    const path = `$.comments[${index}]`;
    const comment = record(value, path);
    const author = record(comment.author, `${path}.author`);
    return {
      id: string(comment.id, `${path}.id`),
      author: string(author.login, `${path}.author.login`),
      createdAt: string(comment.createdAt, `${path}.createdAt`),
      body: string(comment.body, `${path}.body`),
    };
  });
}

type ReviewThreadPage = {
  readonly comments: readonly PullRequestInlineComment[];
  readonly continuations: readonly {
    readonly threadId: string;
    readonly nextCursor: string;
  }[];
  readonly nextCursor: string | null;
};

function parseReviewThreadPage(value: unknown): ReviewThreadPage {
  const data = record(record(value, '$').data, '$.data');
  const repository = record(data.repository, '$.data.repository');
  const pullRequest = record(
    repository.pullRequest,
    '$.data.repository.pullRequest'
  );
  const threadsPath = '$.data.repository.pullRequest.reviewThreads';
  const threads = record(pullRequest.reviewThreads, threadsPath);
  const comments: PullRequestInlineComment[] = [];
  const continuations: { threadId: string; nextCursor: string }[] = [];
  array(threads.nodes, `${threadsPath}.nodes`).forEach(
    (threadValue, threadIndex) => {
      const threadPath = `${threadsPath}.nodes[${threadIndex}]`;
      const thread = record(threadValue, threadPath);
      const resolved = boolean(thread.isResolved, `${threadPath}.isResolved`);
      const threadComments = record(thread.comments, `${threadPath}.comments`);
      comments.push(
        ...parseInlineCommentNodes(
          threadComments.nodes,
          `${threadPath}.comments.nodes`,
          resolved
        )
      );
      const nextCommentsCursor = parseNextCursor(
        threadComments.pageInfo,
        `${threadPath}.comments.pageInfo`
      );
      if (nextCommentsCursor !== null) {
        continuations.push({
          threadId: string(thread.id, `${threadPath}.id`),
          nextCursor: nextCommentsCursor,
        });
      }
    }
  );
  return {
    comments,
    continuations,
    nextCursor: parseNextCursor(threads.pageInfo, `${threadsPath}.pageInfo`),
  };
}

function parseReviewThreadCommentPage(value: unknown): {
  readonly comments: readonly PullRequestInlineComment[];
  readonly nextCursor: string | null;
} {
  const data = record(record(value, '$').data, '$.data');
  const node = record(data.node, '$.data.node');
  const resolved = boolean(node.isResolved, '$.data.node.isResolved');
  const comments = record(node.comments, '$.data.node.comments');
  return {
    comments: parseInlineCommentNodes(
      comments.nodes,
      '$.data.node.comments.nodes',
      resolved
    ),
    nextCursor: parseNextCursor(
      comments.pageInfo,
      '$.data.node.comments.pageInfo'
    ),
  };
}

function parseInlineCommentNodes(
  value: unknown,
  path: string,
  resolved: boolean
): readonly PullRequestInlineComment[] {
  return array(value, path).map((commentValue, index) => {
    const commentPath = `${path}[${index}]`;
    const comment = record(commentValue, commentPath);
    const author = nullableRecord(comment.author, `${commentPath}.author`);
    const replyTo = nullableRecord(comment.replyTo, `${commentPath}.replyTo`);
    return {
      id: String(integer(comment.databaseId, `${commentPath}.databaseId`)),
      author:
        author === null
          ? 'ghost'
          : string(author.login, `${commentPath}.author.login`),
      createdAt: string(comment.createdAt, `${commentPath}.createdAt`),
      body: string(comment.body, `${commentPath}.body`),
      path: string(comment.path, `${commentPath}.path`),
      line:
        nullableInteger(comment.line, `${commentPath}.line`) ??
        nullableInteger(comment.originalLine, `${commentPath}.originalLine`),
      startLine:
        nullableInteger(comment.startLine, `${commentPath}.startLine`) ??
        nullableInteger(
          comment.originalStartLine,
          `${commentPath}.originalStartLine`
        ),
      inReplyToId:
        replyTo === null
          ? null
          : String(
              integer(replyTo.databaseId, `${commentPath}.replyTo.databaseId`)
            ),
      resolved,
      outdated: boolean(comment.outdated, `${commentPath}.outdated`),
    };
  });
}

function parseNextCursor(value: unknown, path: string): string | null {
  const pageInfo = record(value, path);
  return boolean(pageInfo.hasNextPage, `${path}.hasNextPage`)
    ? string(pageInfo.endCursor, `${path}.endCursor`)
    : null;
}

function parseReviewRequest(value: unknown, index: number): string {
  const path = `$.reviewRequests[${index}]`;
  const request = record(value, path);
  if (typeof request.login === 'string') return request.login;
  if (typeof request.name === 'string') return request.name;
  throw incompatible(`${path}.login`, 'a string login or name');
}

function parseReview(
  value: unknown,
  index: number,
  collectionPath: string
): PullRequestReview {
  const path = `${collectionPath}[${index}]`;
  const review = record(value, path);
  const author = record(review.author, `${path}.author`);
  return {
    author: string(author.login, `${path}.author.login`),
    state: string(review.state, `${path}.state`),
    submittedAt: string(review.submittedAt, `${path}.submittedAt`),
    body: string(review.body, `${path}.body`),
  };
}

function decisionFlag(decision: ReviewDecision): string {
  switch (decision) {
    case 'comment':
      return '--comment';
    case 'approve':
      return '--approve';
    case 'requestChanges':
      return '--request-changes';
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw incompatible(path, 'an object');
  }
  return Object.fromEntries(Object.entries(value));
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw incompatible(path, 'an array');
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') throw incompatible(path, 'a string');
  return value;
}

function nullableRecord(
  value: unknown,
  path: string
): Record<string, unknown> | null {
  return value === null ? null : record(value, path);
}

function nullableInteger(value: unknown, path: string): number | null {
  return value === null ? null : integer(value, path);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw incompatible(path, 'a boolean');
  return value;
}

function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw incompatible(path, 'a safe integer');
  }
  return value;
}

class CompatibilityError extends Error {}

function incompatible(path: string, expected: string): CompatibilityError {
  return new CompatibilityError(
    `GitHub CLI returned incompatible data: ${path} must be ${expected}`
  );
}

function failure<Value = never>(
  failureValue: GitHubFailure
): GitHubResult<Value> {
  return { ok: false, failure: failureValue };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
