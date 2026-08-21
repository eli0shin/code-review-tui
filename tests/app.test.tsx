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

function pendingDetails(): Promise<GitHubResult<PullRequestDetails>> {
  return new Promise(() => undefined);
}

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

describe('Review Submission', () => {
  test('submits an exact multiline comment to the captured target and refreshes', async () => {
    const submission = Promise.withResolvers<GitHubResult<void>>();
    const loadReviewQueue = jest.fn(async () =>
      success([pullRequest, secondPullRequest])
    );
    const submitReview = jest.fn(() => submission.promise);
    const github = {
      loadReviewQueue,
      loadPullRequestDetails: pendingDetails,
      submitReview,
    } satisfies GitHub;
    const view = await testRender(<ReviewQueuePage github={github} />, {
      width: 100,
      height: 30,
    });
    await view.waitForFrame((frame) => frame.includes(pullRequest.title));

    await act(async () => view.mockInput.pressKey('s'));
    const modal = await view.waitForFrame((frame) =>
      frame.includes('Review acme/widgets #7')
    );
    expect(modal).toContain('[x] Comment');
    await act(async () => view.mockInput.pressArrow('down'));
    await act(async () => view.mockInput.typeText('First line'));
    await act(view.mockInput.pressEnter);
    await act(async () => view.mockInput.typeText('Second line'));
    await act(async () => {
      view.mockInput.pressKey('s', { ctrl: true });
      view.mockInput.pressKey('s', { ctrl: true });
    });

    expect(submitReview).toHaveBeenCalledTimes(1);
    expect(submitReview).toHaveBeenCalledWith(
      {
        url: pullRequest.url,
        message: 'First line\nSecond line',
        decision: 'comment',
      },
      expect.any(AbortSignal)
    );
    const active = await view.waitForFrame((frame) =>
      frame.includes('Submitting comment')
    );
    expect(active).toContain('› acme/widgets#7');
    await act(async () => submission.resolve(success(undefined)));
    const complete = await view.waitForFrame((frame) =>
      frame.includes('Commented on acme/widgets #7.')
    );
    expect(complete).not.toContain('Review acme/widgets #7');
    expect(loadReviewQueue).toHaveBeenCalledTimes(2);
    view.renderer.destroy();
  });

  test('allows an empty approval and validates request changes only on submit', async () => {
    const submitReview = jest.fn(async () => success(undefined));
    const github = {
      async loadReviewQueue() {
        return success([pullRequest]);
      },
      loadPullRequestDetails: pendingDetails,
      submitReview,
    } satisfies GitHub;
    const view = await testRender(<ReviewQueuePage github={github} />, {
      width: 100,
      height: 30,
    });
    await view.waitForFrame((frame) => frame.includes(pullRequest.title));

    await act(async () => view.mockInput.pressKey('s'));
    await act(view.mockInput.pressTab);
    await act(async () => view.mockInput.pressArrow('right'));
    await act(async () => view.mockInput.pressKey('s', { ctrl: true }));
    await view.waitForFrame((frame) => frame.includes('Approved acme/widgets'));
    expect(submitReview).toHaveBeenNthCalledWith(
      1,
      { url: pullRequest.url, message: '', decision: 'approve' },
      expect.any(AbortSignal)
    );

    await act(async () => view.mockInput.pressKey('s'));
    await act(view.mockInput.pressTab);
    await act(async () => view.mockInput.pressKey('END'));
    await act(async () => view.mockInput.pressKey('s', { ctrl: true }));
    const invalid = await view.waitForFrame((frame) =>
      frame.includes('A message is required for this decision.')
    );
    expect(invalid).toContain('[x] Request changes');
    expect(submitReview).toHaveBeenCalledTimes(1);

    await act(async () => view.mockInput.typeText('  Please fix this  '));
    await view.waitForFrame(
      (frame) => !frame.includes('A message is required for this decision.')
    );
    await act(async () => view.mockInput.pressKey('s', { ctrl: true }));
    await view.waitForFrame((frame) =>
      frame.includes('Requested changes on acme/widgets')
    );
    expect(submitReview).toHaveBeenNthCalledWith(
      2,
      {
        url: pullRequest.url,
        message: '  Please fix this  ',
        decision: 'requestChanges',
      },
      expect.any(AbortSignal)
    );
    view.renderer.destroy();
  });

  test('keeps the same submission controls after a failure', async () => {
    const firstAttempt = Promise.withResolvers<GitHubResult<void>>();
    const secondAttempt = Promise.withResolvers<GitHubResult<void>>();
    const attempts = [firstAttempt.promise, secondAttempt.promise];
    let attemptIndex = 0;
    const submitReview = jest.fn(
      (..._arguments: Parameters<GitHub['submitReview']>) => {
        const attempt = attempts[attemptIndex];
        attemptIndex += 1;
        return attempt;
      }
    );
    const github = {
      async loadReviewQueue() {
        return success([pullRequest]);
      },
      loadPullRequestDetails: pendingDetails,
      submitReview,
    } satisfies GitHub;
    const view = await testRender(<ReviewQueuePage github={github} />, {
      width: 100,
      height: 30,
    });
    await view.waitForFrame((frame) => frame.includes(pullRequest.title));
    await act(async () => view.mockInput.pressKey('s'));
    await act(async () => view.mockInput.typeText('Ship it'));
    await act(async () => view.mockInput.pressKey('s', { ctrl: true }));
    await act(async () =>
      firstAttempt.resolve({
        ok: false,
        failure: {
          kind: 'exit',
          operation: 'reviewSubmission',
          url: pullRequest.url,
          exitCode: 1,
          stderr: 'permission denied',
        },
      })
    );
    const failed = await view.waitForFrame((frame) =>
      frame.includes('permission denied')
    );
    expect(failed).toContain('Ship it');
    expect(failed).toContain('Ctrl+S submit');
    expect(failed).not.toContain('retry');
    expect(submitReview).toHaveBeenCalledTimes(1);

    await act(async () => view.mockInput.pressKey('s', { ctrl: true }));
    const submitting = await view.waitForFrame((frame) =>
      frame.includes('Submitting comment')
    );
    expect(submitting).not.toContain('permission denied');
    expect(submitReview).toHaveBeenCalledTimes(2);
    expect(submitReview.mock.calls[1][0]).toEqual(
      submitReview.mock.calls[0][0]
    );
    await act(async () => secondAttempt.resolve(success(undefined)));
    await view.waitForFrame((frame) => frame.includes('Commented on'));
    view.renderer.destroy();
  });

  test('keeps or discards a changed draft and closes an untouched draft', async () => {
    const submitReview = jest.fn(async () => success(undefined));
    const github = {
      async loadReviewQueue() {
        return success([pullRequest, secondPullRequest]);
      },
      loadPullRequestDetails: pendingDetails,
      submitReview,
    } satisfies GitHub;
    const view = await testRender(<ReviewQueuePage github={github} />, {
      width: 100,
      height: 30,
      kittyKeyboard: true,
    });
    await view.waitForFrame((frame) => frame.includes(pullRequest.title));

    await act(async () => view.mockInput.pressKey('s'));
    await view.waitForFrame((frame) =>
      frame.includes('Review acme/widgets #7')
    );
    await act(view.mockInput.pressEscape);
    await view.waitForFrame(
      (frame) => !frame.includes('Review acme/widgets #7')
    );

    await act(async () => view.mockInput.pressKey('s'));
    await view.waitForFrame((frame) =>
      frame.includes('Review acme/widgets #7')
    );
    await act(async () => view.mockInput.typeText('Draft'));
    await act(view.mockInput.pressEscape);
    const confirmation = await view.waitForFrame((frame) =>
      frame.includes('Discard this Review Submission?')
    );
    expect(confirmation).toContain('[x] Keep editing');
    await act(view.mockInput.pressEnter);
    const kept = await view.waitForFrame((frame) => frame.includes('Draft'));
    expect(kept).toContain('Ctrl+S submit');

    await act(view.mockInput.pressEscape);
    await view.waitForFrame((frame) =>
      frame.includes('Discard this Review Submission?')
    );
    await act(async () => view.mockInput.pressArrow('right'));
    await view.waitForFrame((frame) => frame.includes('[x] Discard'));
    await act(view.mockInput.pressEscape);
    await view.waitForFrame((frame) => frame.includes('Draft'));

    await act(view.mockInput.pressEscape);
    const reopenedConfirmation = await view.waitForFrame((frame) =>
      frame.includes('Discard this Review Submission?')
    );
    expect(reopenedConfirmation).toContain('[x] Keep editing');
    await act(view.mockInput.pressEnter);
    await view.waitForFrame((frame) => frame.includes('Draft'));

    await act(view.mockInput.pressEscape);
    await view.waitForFrame((frame) =>
      frame.includes('Discard this Review Submission?')
    );
    await act(async () => view.mockInput.pressArrow('right'));
    await view.waitForFrame((frame) => frame.includes('[x] Discard'));
    await act(view.mockInput.pressEnter);
    const discarded = await view.waitForFrame(
      (frame) => !frame.includes('Review acme/widgets #7')
    );
    expect(discarded).toContain('› acme/widgets#7');
    expect(submitReview).not.toHaveBeenCalled();
    view.renderer.destroy();
  });
});
