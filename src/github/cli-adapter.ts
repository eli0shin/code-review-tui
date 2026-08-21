import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  PullRequestDetails,
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
  'number,title,body,author,state,isDraft,url,createdAt,updatedAt,baseRefName,headRefName,additions,deletions,changedFiles,labels,reviewDecision,reviewRequests,latestReviews';

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
      const processResult = await runGh(
        ['pr', 'view', url, '--json', detailFields],
        '',
        'pullRequestDetails',
        url,
        signal
      );
      if (!processResult.ok) return processResult;
      return parseOutput(
        processResult.value,
        'pullRequestDetails',
        parsePullRequestDetails,
        url
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
    latestReviews: array(item.latestReviews, '$.latestReviews').map(
      parseReview
    ),
  };
}

function parseReviewRequest(value: unknown, index: number): string {
  const path = `$.reviewRequests[${index}]`;
  const request = record(value, path);
  if (typeof request.login === 'string') return request.login;
  if (typeof request.name === 'string') return request.name;
  throw incompatible(`${path}.login`, 'a string login or name');
}

function parseReview(value: unknown, index: number): PullRequestReview {
  const path = `$.latestReviews[${index}]`;
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
