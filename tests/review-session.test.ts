import { describe, expect, test } from 'bun:test';
import type {
  PullRequestDetails,
  PullRequestSummary,
  ReviewQueue,
  ReviewSubmission,
} from '../src/domain/pull-request.ts';
import type {
  GitHub,
  GitHubFailure,
  GitHubResult,
} from '../src/github/types.ts';
import { createReviewSession } from '../src/session/review-session.ts';

const queueFailure = {
  kind: 'exit',
  operation: 'reviewQueue',
  exitCode: 1,
  stderr: 'search failed',
} satisfies GitHubFailure;

const detailFailure = {
  kind: 'exit',
  operation: 'pullRequestDetails',
  url: 'https://github.example/acme/widgets/pull/1',
  exitCode: 1,
  stderr: 'view failed',
} satisfies GitHubFailure;

describe('ReviewSession queue and details contract', () => {
  test('loads the initial Review Queue, selects its first item, and loads details', async () => {
    const github = createControllableGitHub();
    const session = createReviewSession(github);
    const snapshots: string[] = [];
    const unsubscribe = session.subscribe(() => {
      snapshots.push(JSON.stringify(session.getSnapshot()));
    });

    const started = session.start();
    expect(session.getSnapshot()).toEqual({
      queue: [],
      queueLoad: { phase: 'initialLoading' },
      selectedUrl: undefined,
      details: { phase: 'idle' },
    });

    queueCall(github, 0).resolve(success([summary(1), summary(2)]));
    await started;

    expect(github.detailCalls.map((call) => call.url)).toEqual([
      summary(1).url,
    ]);
    expect(session.getSnapshot()).toEqual({
      queue: [summary(1), summary(2)],
      queueLoad: { phase: 'idle' },
      selectedUrl: summary(1).url,
      details: { phase: 'loading', url: summary(1).url },
    });

    detailCall(github, 0).result.resolve(success(details(1)));
    await settle();
    expect(session.getSnapshot().details).toEqual({
      phase: 'ready',
      url: summary(1).url,
      value: details(1),
    });
    expect(snapshots.length).toBeGreaterThanOrEqual(3);

    unsubscribe();
    session.dispatch({ type: 'refresh' });
  });

  test('keeps the old queue visible during refresh and atomically preserves selection by URL', async () => {
    const github = createControllableGitHub();
    const session = createReviewSession(github);
    await loadInitial(session, github, [summary(1), summary(2)]);
    session.dispatch({ type: 'selectNext' });
    expect(detailCall(github, 0).signal.aborted).toBe(true);
    detailCall(github, 1).result.resolve(success(details(2)));
    await settle();

    session.dispatch({ type: 'refresh' });
    expect(session.getSnapshot()).toEqual({
      queue: [summary(1), summary(2)],
      queueLoad: { phase: 'refreshing' },
      selectedUrl: summary(2).url,
      details: { phase: 'ready', url: summary(2).url, value: details(2) },
    });

    queueCall(github, 1).resolve(success([summary(3), summary(2)]));
    await settle();
    expect(session.getSnapshot()).toEqual({
      queue: [summary(3), summary(2)],
      queueLoad: { phase: 'idle' },
      selectedUrl: summary(2).url,
      details: {
        phase: 'loading',
        url: summary(2).url,
        staleValue: details(2),
      },
    });
    expect(detailCall(github, 2).url).toBe(summary(2).url);
  });

  test('falls back to the first replacement item and clears selection for an empty queue', async () => {
    const github = createControllableGitHub();
    const session = createReviewSession(github);
    await loadInitial(session, github, [summary(1), summary(2)]);
    session.dispatch({ type: 'selectNext' });

    session.dispatch({ type: 'refresh' });
    queueCall(github, 1).resolve(success([summary(3), summary(1)]));
    await settle();
    expect(session.getSnapshot().selectedUrl).toBe(summary(3).url);
    expect(session.getSnapshot().details).toEqual({
      phase: 'loading',
      url: summary(3).url,
    });

    session.dispatch({ type: 'refresh' });
    queueCall(github, 2).resolve(success([]));
    await settle();
    expect(session.getSnapshot()).toEqual({
      queue: [],
      queueLoad: { phase: 'idle' },
      selectedUrl: undefined,
      details: { phase: 'idle' },
    });

    session.dispatch({ type: 'refresh' });
    expect(session.getSnapshot().queueLoad).toEqual({ phase: 'refreshing' });
    queueCall(github, 3).resolve(failure(queueFailure));
    await settle();
    expect(session.getSnapshot().queueLoad).toEqual({
      phase: 'failed',
      load: 'refresh',
      failure: queueFailure,
    });
  });

  test('shows an unavailable state when the initial Review Queue load fails', async () => {
    const github = createControllableGitHub();
    const session = createReviewSession(github);
    const started = session.start();
    queueCall(github, 0).resolve(failure(queueFailure));
    await started;

    expect(session.getSnapshot()).toEqual({
      queue: [],
      queueLoad: {
        phase: 'failed',
        load: 'initial',
        failure: queueFailure,
      },
      selectedUrl: undefined,
      details: { phase: 'idle' },
    });
  });

  test('preserves valid queue data after refresh and detail failures', async () => {
    const github = createControllableGitHub();
    const session = createReviewSession(github);
    await loadInitial(session, github, [summary(1)]);
    detailCall(github, 0).result.resolve(failure(detailFailure));
    await settle();
    expect(session.getSnapshot().details).toEqual({
      phase: 'failed',
      url: summary(1).url,
      failure: detailFailure,
    });

    session.dispatch({ type: 'refresh' });
    queueCall(github, 1).resolve(failure(queueFailure));
    await settle();
    expect(session.getSnapshot()).toEqual({
      queue: [summary(1)],
      queueLoad: {
        phase: 'failed',
        load: 'refresh',
        failure: queueFailure,
      },
      selectedUrl: summary(1).url,
      details: {
        phase: 'failed',
        url: summary(1).url,
        failure: detailFailure,
      },
    });
  });

  test('coalesces many refresh requests into one pending load', async () => {
    const github = createControllableGitHub();
    const session = createReviewSession(github);
    await loadInitial(session, github, [summary(1)]);

    session.dispatch({ type: 'refresh' });
    session.dispatch({ type: 'refresh' });
    session.dispatch({ type: 'refresh' });
    session.dispatch({ type: 'refresh' });
    expect(github.queueCalls).toHaveLength(2);

    queueCall(github, 1).resolve(success([summary(1), summary(2)]));
    await settle();
    expect(github.queueCalls).toHaveLength(3);
    expect(session.getSnapshot().queueLoad).toEqual({ phase: 'refreshing' });

    queueCall(github, 2).resolve(success([summary(2)]));
    await settle();
    expect(github.queueCalls).toHaveLength(3);
    expect(session.getSnapshot().queue).toEqual([summary(2)]);
  });

  test('never lets late details replace details for the current selection', async () => {
    const github = createControllableGitHub();
    const session = createReviewSession(github);
    await loadInitial(session, github, [summary(1), summary(2)]);

    session.dispatch({ type: 'selectNext' });
    detailCall(github, 1).result.resolve(success(details(2)));
    await settle();
    detailCall(github, 0).result.resolve(success(details(1)));
    await settle();

    expect(session.getSnapshot().selectedUrl).toBe(summary(2).url);
    expect(session.getSnapshot().details).toEqual({
      phase: 'ready',
      url: summary(2).url,
      value: details(2),
    });
  });

  test('reselecting the current pull request retries and obsoletes its prior detail load', async () => {
    const github = createControllableGitHub();
    const session = createReviewSession(github);
    await loadInitial(session, github, [summary(1)]);

    session.dispatch({ type: 'select', url: summary(1).url });
    expect(github.detailCalls).toHaveLength(2);
    expect(detailCall(github, 0).signal.aborted).toBe(true);
    detailCall(github, 1).result.resolve(success(details(1, 'new')));
    detailCall(github, 0).result.resolve(success(details(1, 'old')));
    await settle();

    expect(session.getSnapshot().details).toEqual({
      phase: 'ready',
      url: summary(1).url,
      value: details(1, 'new'),
    });
  });
});

type ControllableGitHub = GitHub & {
  readonly queueCalls: {
    readonly signal: AbortSignal;
    readonly resolve: Deferred<GitHubResult<ReviewQueue>>['resolve'];
  }[];
  readonly detailCalls: {
    readonly url: string;
    readonly signal: AbortSignal;
    readonly result: Deferred<GitHubResult<PullRequestDetails>>;
  }[];
};

function createControllableGitHub(): ControllableGitHub {
  const queueCalls: ControllableGitHub['queueCalls'] = [];
  const detailCalls: ControllableGitHub['detailCalls'] = [];
  return {
    queueCalls,
    detailCalls,
    loadReviewQueue(signal) {
      const result = deferred<GitHubResult<ReviewQueue>>();
      queueCalls.push({ signal, resolve: result.resolve });
      return result.promise;
    },
    loadPullRequestDetails(url, signal) {
      const result = deferred<GitHubResult<PullRequestDetails>>();
      detailCalls.push({ url, signal, result });
      return result.promise;
    },
    submitReview(_submission: ReviewSubmission, _signal: AbortSignal) {
      return Promise.reject(
        new Error('Review Submission is outside this contract slice')
      );
    },
  };
}

function queueCall(
  github: ControllableGitHub,
  index: number
): ControllableGitHub['queueCalls'][number] {
  const call = github.queueCalls.at(index);
  if (call === undefined) throw new Error(`Missing queue call ${index}`);
  return call;
}

function detailCall(
  github: ControllableGitHub,
  index: number
): ControllableGitHub['detailCalls'][number] {
  const call = github.detailCalls.at(index);
  if (call === undefined) throw new Error(`Missing detail call ${index}`);
  return call;
}

type Deferred<Value> = {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
};

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settlePromise) => {
    resolve = settlePromise;
  });
  return { promise, resolve };
}

async function loadInitial(
  session: ReturnType<typeof createReviewSession>,
  github: ControllableGitHub,
  queue: ReviewQueue
): Promise<void> {
  const started = session.start();
  queueCall(github, 0).resolve(success(queue));
  await started;
}

function success<Value>(value: Value): GitHubResult<Value> {
  return { ok: true, value };
}

function failure<Value>(value: GitHubFailure): GitHubResult<Value> {
  return { ok: false, failure: value };
}

function summary(number: number): PullRequestSummary {
  return {
    url: `https://github.example/acme/widgets/pull/${number}`,
    repository: 'acme/widgets',
    number,
    title: `Pull request ${number}`,
    author: 'octocat',
    isDraft: false,
    state: 'open',
    createdAt: '2026-08-20T10:00:00Z',
    updatedAt: '2026-08-21T11:00:00Z',
  };
}

function details(number: number, body = `Body ${number}`): PullRequestDetails {
  return {
    url: summary(number).url,
    number,
    title: summary(number).title,
    body,
    author: 'octocat',
    state: 'OPEN',
    isDraft: false,
    createdAt: '2026-08-20T10:00:00Z',
    updatedAt: '2026-08-21T11:00:00Z',
    baseRefName: 'main',
    headRefName: `change-${number}`,
    additions: number,
    deletions: 0,
    changedFiles: 1,
    labels: [],
    reviewDecision: 'REVIEW_REQUIRED',
    reviewRequests: [],
    latestReviews: [],
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
