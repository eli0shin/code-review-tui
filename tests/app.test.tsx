import { afterEach, describe, expect, jest, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';
import { testRender } from '@opentui/react/test-utils';
import { notifyManager } from '@tanstack/react-query';
import { act } from 'react';
import { App, ReviewQueuePage } from '../src/app.tsx';
import type {
  PullRequestDetails,
  PullRequestSummary,
  ReviewQueue,
} from '../src/domain/pull-request.ts';
import type { GitHub, GitHubResult } from '../src/github/types.ts';

notifyManager.setScheduler(queueMicrotask);
notifyManager.setNotifyFunction(act);

const pullRequest = {
  url: 'https://github.com/acme/widgets/pull/7',
  repository: 'acme/widgets',
  number: 7,
  title: 'Improve widgets',
  author: 'octocat',
  isDraft: false,
  state: 'open',
  createdAt: '2026-08-20T10:00:00Z',
  updatedAt: '2026-08-21T10:00:00Z',
} satisfies PullRequestSummary;

const secondPullRequest = {
  ...pullRequest,
  url: 'https://github.com/acme/widgets/pull/8',
  number: 8,
  title: 'Add more widgets',
} satisfies PullRequestSummary;

const thirdPullRequest = {
  ...pullRequest,
  url: 'https://github.com/acme/widgets/pull/9',
  number: 9,
  title: 'Repair old widgets',
} satisfies PullRequestSummary;

function pullRequestDetails(
  title: string,
  request: PullRequestSummary = pullRequest
): PullRequestDetails {
  return {
    url: request.url,
    number: request.number,
    title,
    body: 'Pull request body',
    author: request.author,
    state: request.state,
    isDraft: request.isDraft,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    baseRefName: 'main',
    headRefName: 'widgets',
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    labels: [],
    reviewDecision: '',
    reviewRequests: [],
    latestReviews: [],
  };
}

function success<Value>(value: Value): GitHubResult<Value> {
  return { ok: true, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

afterEach(() => {
  jest.useRealTimers();
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});

describe('application shell', () => {
  test('identifies the Review Queue', () => {
    const view: unknown = App();
    expect(isRecord(view)).toBe(true);
    if (!isRecord(view)) return;

    const props = view['props'];
    expect(isRecord(props) ? props['children'] : undefined).toBe(
      'Review Queue'
    );
  });
});

describe('Review Queue page loading', () => {
  test('loads on mount, r, and 60 seconds and cancels on unmount', async () => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      configurable: true,
      value: true,
    });
    const initialQueue = Promise.withResolvers<GitHubResult<ReviewQueue>>();
    const manualQueue = Promise.withResolvers<GitHubResult<ReviewQueue>>();
    const timedQueue = Promise.withResolvers<GitHubResult<ReviewQueue>>();
    const unmountedQueue = Promise.withResolvers<GitHubResult<ReviewQueue>>();
    const queueLoads = [
      initialQueue.promise,
      manualQueue.promise,
      timedQueue.promise,
      unmountedQueue.promise,
    ];
    let queueLoadIndex = 0;
    const loadReviewQueue = jest.fn((_signal: AbortSignal) => {
      const queueLoad = queueLoads[queueLoadIndex];
      queueLoadIndex += 1;
      return queueLoad;
    });
    const intervalSpy = jest.spyOn(globalThis, 'setInterval');
    const github = {
      loadReviewQueue,
      async loadPullRequestDetails() {
        throw new Error('No pull request is highlighted');
      },
      async submitReview() {
        throw new Error('Review Submission is not part of this page test');
      },
    } satisfies GitHub;

    const view = await createTestRenderer({ width: 80, height: 24 });
    const root = createRoot(view.renderer);
    act(() => {
      root.render(<ReviewQueuePage github={github} />);
    });
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain('Loading pull requests');
    expect(loadReviewQueue).toHaveBeenCalledTimes(1);

    await act(async () => initialQueue.resolve(success([])));
    await view.waitForFrame((frame) =>
      frame.includes('No pull requests need your review.')
    );
    await act(async () => view.mockInput.pressKey('r'));
    expect(loadReviewQueue).toHaveBeenCalledTimes(2);
    await act(async () => manualQueue.resolve(success([])));

    const intervalCall = intervalSpy.mock.calls.find(
      ([, delay]) => delay === 60_000
    );
    expect(intervalCall).toBeDefined();
    const intervalCallback = intervalCall?.[0];
    if (typeof intervalCallback !== 'function') {
      throw new Error('The query refresh interval callback is missing');
    }
    await act(async () => {
      intervalCallback();
      await Promise.resolve();
    });
    expect(loadReviewQueue).toHaveBeenCalledTimes(3);
    await act(async () => timedQueue.resolve(success([])));

    await act(async () => view.mockInput.pressKey('r'));
    expect(loadReviewQueue).toHaveBeenCalledTimes(4);
    const activeSignal = loadReviewQueue.mock.calls[3][0];
    expect(activeSignal.aborted).toBe(false);
    act(() => {
      root.unmount();
    });
    expect(activeSignal.aborted).toBe(true);
    view.renderer.destroy();
  });

  test('moves the Cursor and loads details for its highlighted row', async () => {
    const queueLoad = Promise.withResolvers<GitHubResult<ReviewQueue>>();
    const firstDetails =
      Promise.withResolvers<GitHubResult<PullRequestDetails>>();
    const secondDetails =
      Promise.withResolvers<GitHubResult<PullRequestDetails>>();
    const detailLoads = [firstDetails.promise, secondDetails.promise];
    let detailLoadIndex = 0;
    const loadPullRequestDetails = jest.fn((_url: string) => {
      const detailLoad = detailLoads[detailLoadIndex];
      detailLoadIndex += 1;
      return detailLoad;
    });
    const github = {
      loadReviewQueue() {
        return queueLoad.promise;
      },
      loadPullRequestDetails,
      async submitReview() {
        throw new Error('Review Submission is not part of this page test');
      },
    } satisfies GitHub;

    const view = await testRender(<ReviewQueuePage github={github} />, {
      width: 80,
      height: 24,
    });
    await act(async () =>
      queueLoad.resolve(success([pullRequest, secondPullRequest]))
    );
    const detailsLoadingFrame = await view.waitForFrame((frame) =>
      frame.includes('Loading pull request details…')
    );
    expect(detailsLoadingFrame).toContain('Loading pull request details…');
    await act(async () =>
      firstDetails.resolve(success(pullRequestDetails('First details')))
    );
    await view.waitForFrame((frame) => frame.includes('First details'));
    expect(loadPullRequestDetails).toHaveBeenNthCalledWith(
      1,
      pullRequest.url,
      expect.any(AbortSignal)
    );

    await act(async () => view.mockInput.pressArrow('down'));
    await act(async () =>
      secondDetails.resolve(
        success(pullRequestDetails('Second details', secondPullRequest))
      )
    );
    const cursorFrame = await view.waitForFrame((frame) =>
      frame.includes('Second details')
    );
    expect(cursorFrame).toContain('Second details');
    expect(loadPullRequestDetails).toHaveBeenNthCalledWith(
      2,
      secondPullRequest.url,
      expect.any(AbortSignal)
    );
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      configurable: true,
      value: false,
    });
    view.renderer.destroy();
  });

  test('clamps the Cursor state when the queue shrinks', async () => {
    const initialQueue = Promise.withResolvers<GitHubResult<ReviewQueue>>();
    const shorterQueue = Promise.withResolvers<GitHubResult<ReviewQueue>>();
    const longerQueue = Promise.withResolvers<GitHubResult<ReviewQueue>>();
    const queueLoads = [
      initialQueue.promise,
      shorterQueue.promise,
      longerQueue.promise,
    ];
    let queueLoadIndex = 0;
    const pendingDetails = Promise.withResolvers<never>().promise;
    const github = {
      loadReviewQueue() {
        const queueLoad = queueLoads[queueLoadIndex];
        queueLoadIndex += 1;
        return queueLoad;
      },
      loadPullRequestDetails() {
        return pendingDetails;
      },
      async submitReview() {
        throw new Error('Review Submission is not part of this page test');
      },
    } satisfies GitHub;

    const view = await testRender(<ReviewQueuePage github={github} />, {
      width: 80,
      height: 24,
    });
    await act(async () =>
      initialQueue.resolve(
        success([pullRequest, secondPullRequest, thirdPullRequest])
      )
    );
    await view.waitForFrame((frame) => frame.includes(thirdPullRequest.title));

    await act(async () => view.mockInput.pressArrow('down'));
    await act(async () => view.mockInput.pressArrow('down'));
    await view.waitForFrame((frame) =>
      frame.includes(`› ${thirdPullRequest.repository}#9`)
    );

    await act(async () => view.mockInput.pressKey('r'));
    await act(async () =>
      shorterQueue.resolve(success([pullRequest, secondPullRequest]))
    );
    await view.waitForFrame((frame) =>
      frame.includes(`› ${secondPullRequest.repository}#8`)
    );

    await act(async () => view.mockInput.pressKey('r'));
    await act(async () =>
      longerQueue.resolve(
        success([pullRequest, secondPullRequest, thirdPullRequest])
      )
    );
    const restoredQueueFrame = await view.waitForFrame(
      (frame) =>
        frame.includes(`› ${secondPullRequest.repository}#8`) &&
        frame.includes(`  ${thirdPullRequest.repository}#9`)
    );
    expect(restoredQueueFrame).toContain(`› ${secondPullRequest.repository}#8`);
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      configurable: true,
      value: false,
    });
    view.renderer.destroy();
  });

  test('shows stderr with malformed-data diagnostics', async () => {
    const queueLoad = Promise.withResolvers<GitHubResult<ReviewQueue>>();
    const github = {
      loadReviewQueue() {
        return queueLoad.promise;
      },
      async loadPullRequestDetails() {
        throw new Error('No pull request is highlighted');
      },
      async submitReview() {
        throw new Error('Review Submission is not part of this page test');
      },
    } satisfies GitHub;

    const view = await testRender(<ReviewQueuePage github={github} />, {
      width: 80,
      height: 24,
    });
    await act(async () =>
      queueLoad.resolve({
        ok: false,
        failure: {
          kind: 'malformedData',
          operation: 'reviewQueue',
          diagnostic: 'GitHub CLI returned malformed JSON',
          stderr: 'gh warning: repair authentication',
        },
      })
    );
    const frame = await view.waitForFrame((renderedFrame) =>
      renderedFrame.includes('gh warning: repair authentication')
    );
    expect(frame).toContain('GitHub CLI returned malformed JSON');
    expect(frame).toContain('gh warning: repair authentication');
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      configurable: true,
      value: false,
    });
    view.renderer.destroy();
  });
});
