import { afterEach, describe, expect, jest, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';
import { testRender } from '@opentui/react/test-utils';
import { act } from 'react';
import { App, ReviewQueuePage } from '../src/app.tsx';
import type {
  PullRequestDetails,
  PullRequestSummary,
  ReviewQueue,
} from '../src/domain/pull-request.ts';
import type { GitHub, GitHubResult } from '../src/github/types.ts';

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

function pullRequestDetails(title: string): PullRequestDetails {
  return {
    url: pullRequest.url,
    number: pullRequest.number,
    title,
    body: 'Pull request body',
    author: pullRequest.author,
    state: pullRequest.state,
    isDraft: pullRequest.isDraft,
    createdAt: pullRequest.createdAt,
    updatedAt: pullRequest.updatedAt,
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
  test('loads on open, r, and the 60-second timer and clears the timer on unmount', async () => {
    jest.useFakeTimers();
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      configurable: true,
      value: true,
    });
    const pendingQueueLoad = Promise.withResolvers<never>().promise;
    const loadReviewQueue = jest.fn(async () => await pendingQueueLoad);
    const setIntervalSpy = jest.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');
    const github = {
      loadReviewQueue,
      async loadPullRequestDetails() {
        throw new Error('No pull request is selected');
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
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);

    await act(async () => view.mockInput.pressKey('r'));
    expect(loadReviewQueue).toHaveBeenCalledTimes(2);

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(loadReviewQueue).toHaveBeenCalledTimes(3);

    const clearCallsBeforeUnmount = clearIntervalSpy.mock.calls.length;
    act(() => {
      root.unmount();
    });
    expect(clearIntervalSpy).toHaveBeenCalledTimes(clearCallsBeforeUnmount + 1);
    view.renderer.destroy();
  });

  test('reloads details when refresh preserves the selected URL', async () => {
    const initialQueue = Promise.withResolvers<GitHubResult<ReviewQueue>>();
    const refreshedQueue = Promise.withResolvers<GitHubResult<ReviewQueue>>();
    const initialDetails =
      Promise.withResolvers<GitHubResult<PullRequestDetails>>();
    const refreshedDetails =
      Promise.withResolvers<GitHubResult<PullRequestDetails>>();
    let queueLoad = initialQueue.promise;
    let detailLoad = initialDetails.promise;
    const github = {
      loadReviewQueue() {
        const result = queueLoad;
        queueLoad = refreshedQueue.promise;
        return result;
      },
      loadPullRequestDetails() {
        const result = detailLoad;
        detailLoad = refreshedDetails.promise;
        return result;
      },
      async submitReview() {
        throw new Error('Review Submission is not part of this page test');
      },
    } satisfies GitHub;

    const view = await testRender(<ReviewQueuePage github={github} />, {
      width: 80,
      height: 24,
    });
    await act(async () => initialQueue.resolve(success([pullRequest])));
    await act(async () =>
      initialDetails.resolve(success(pullRequestDetails('Original details')))
    );
    await view.waitForFrame((frame) => frame.includes('Original details'));

    await act(async () => view.mockInput.pressKey('r'));
    await act(async () => refreshedQueue.resolve(success([pullRequest])));
    await act(async () =>
      refreshedDetails.resolve(success(pullRequestDetails('Updated details')))
    );
    await view.waitForFrame((frame) => frame.includes('Updated details'));
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
        throw new Error('No pull request is selected');
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
