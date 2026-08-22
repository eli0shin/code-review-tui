import { afterEach, describe, expect, jest, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';
import { testRender } from '@opentui/react/test-utils';
import { notifyManager } from '@tanstack/react-query';
import { act } from 'react';
import { App, ReviewQueuePage } from '../src/app.tsx';
import type { EffectiveKeyBindings } from '../src/configuration/index.ts';
import type {
  PullRequestDetails,
  PullRequestSummary,
  ReviewQueue,
} from '../src/domain/pull-request.ts';
import type {
  GitHub,
  GitHubResult,
  PullRequestDetailSources,
} from '../src/github/types.ts';
import type { Herdr, HerdrResult } from '../src/tools/types.ts';

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
  additions: 10,
  deletions: 2,
  changedFiles: 1,
  labels: ['review'],
  commentsCount: 3,
} satisfies PullRequestSummary;

const secondPullRequest = {
  ...pullRequest,
  url: 'https://github.com/acme/widgets/pull/8',
  number: 8,
  title: 'Add more widgets',
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
  };
}

function success<Value>(value: Value): GitHubResult<Value> {
  return { ok: true, value };
}

const unusedHerdr = {
  async openLumen() {
    throw new Error('Lumen is not part of this page test');
  },
  async openReviewCommand() {
    throw new Error('The Review Command is not part of this page test');
  },
} satisfies Herdr;

const defaultKeyBindings = {
  selectPrevious: ['k', 'up'],
  selectNext: ['j', 'down'],
  openDetails: ['enter'],
  openDiff: ['d'],
  runReviewCommand: ['c'],
  composeReviewSubmission: ['s'],
  refresh: ['r'],
  pagePrevious: ['ctrl+u'],
  pageNext: ['ctrl+d'],
  scrollStart: ['g', 'home'],
  scrollEnd: ['shift+g', 'end'],
  showErrors: ['e'],
  showHelp: ['?'],
  quit: ['q', 'escape'],
} satisfies EffectiveKeyBindings;

function reviewQueuePage(
  github: GitHub,
  herdr: Herdr = unusedHerdr,
  keyBindings: EffectiveKeyBindings = defaultKeyBindings,
  onQuit: () => void = () => undefined
) {
  return (
    <ReviewQueuePage
      github={github}
      herdr={herdr}
      keyBindings={keyBindings}
      onQuit={onQuit}
    />
  );
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

function detailSources(metadata: PullRequestDetails): PullRequestDetailSources {
  return {
    metadata: success(metadata),
    reviews: success([]),
    checks: success([]),
    issueComments: success([]),
    inlineComments: success([]),
  };
}

function pendingDetails(): Promise<PullRequestDetailSources> {
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
      root.render(reviewQueuePage(github));
    });
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain('Loading review requests');
    expect(loadReviewQueue).toHaveBeenCalledTimes(1);

    await act(async () => initialQueue.resolve(success([])));
    await view.waitForFrame((frame) => frame.includes('No reviews waiting'));
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

  test('uses all queue rows until Enter opens captured full-screen details', async () => {
    const loadPullRequestDetails = jest.fn(async (url: string) =>
      detailSources(
        pullRequestDetails(
          'Captured details',
          url === pullRequest.url ? pullRequest : secondPullRequest
        )
      )
    );
    const thirdPullRequest = {
      ...pullRequest,
      url: 'https://github.com/acme/widgets/pull/9',
      number: 9,
      title: 'Repair old widgets',
    } satisfies PullRequestSummary;
    const github = {
      async loadReviewQueue() {
        return success([pullRequest, secondPullRequest, thirdPullRequest]);
      },
      loadPullRequestDetails,
      async submitReview() {
        throw new Error('Review Submission is not part of this page test');
      },
    } satisfies GitHub;
    const view = await testRender(reviewQueuePage(github), {
      width: 90,
      height: 18,
    });

    const queueFrame = await view.waitForFrame((frame) =>
      frame.includes('Repair old widgets')
    );
    expect(queueFrame).not.toContain('Pull request details ·');
    expect(loadPullRequestDetails).not.toHaveBeenCalled();

    act(() => {
      view.mockInput.pressEnter();
    });
    const modal = await view.waitForFrame((frame) =>
      frame.includes('Pull request details · acme/widgets #7')
    );
    expect(modal).not.toContain('Review requests 3 open');
    expect(loadPullRequestDetails).toHaveBeenCalledWith(
      pullRequest.url,
      expect.any(AbortSignal)
    );

    await act(async () => view.mockInput.pressKey('q'));
    const returned = await view.waitForFrame((frame) =>
      frame.includes('Review requests 3 open')
    );
    expect(returned).toContain('Improve widgets');
    view.renderer.destroy();
  });

  test('renders complete review context as plain text and uses configurable scrolling', async () => {
    const details = {
      ...pullRequestDetails('Complete details'),
      body: Array.from({ length: 20 }, (_, index) =>
        index === 10 ? '# literal **Markdown**' : `description line ${index}`
      ).join('\n'),
    };
    const sources = {
      metadata: success(details),
      reviews: success([
        {
          author: 'reviewer',
          state: 'CHANGES_REQUESTED',
          submittedAt: '2026-08-21T11:00:00Z',
          body: '',
        },
      ]),
      checks: success([{ name: 'build', state: 'SUCCESS' }]),
      issueComments: success([
        {
          id: 'issue-1',
          author: 'commenter',
          createdAt: '2026-08-21T10:00:00Z',
          body: 'issue body',
        },
      ]),
      inlineComments: success([
        {
          id: '99',
          author: 'inline-reviewer',
          createdAt: '2026-08-21T12:00:00Z',
          body: 'inline body',
          path: 'src/widget.ts',
          startLine: 4,
          line: 7,
          inReplyToId: '88',
          resolved: true,
          outdated: true,
        },
      ]),
    };
    const github = {
      async loadReviewQueue() {
        return success([pullRequest]);
      },
      async loadPullRequestDetails() {
        return sources;
      },
      async submitReview() {
        throw new Error('Review Submission is not part of this page test');
      },
    } satisfies GitHub;
    const bindings = {
      ...defaultKeyBindings,
      selectPrevious: ['i'],
      selectNext: ['m'],
      pagePrevious: ['u'],
      pageNext: ['v'],
      scrollStart: ['a'],
      scrollEnd: ['b'],
    } satisfies EffectiveKeyBindings;
    const view = await testRender(
      reviewQueuePage(github, unusedHerdr, bindings),
      {
        width: 100,
        height: 20,
      }
    );

    await view.waitForFrame((frame) => frame.includes('Improve widgets'));
    act(() => {
      view.mockInput.pressEnter();
    });
    await view.waitForFrame((frame) => frame.includes('Reviewers'));
    await act(async () => view.mockInput.pressKey('v'));
    await act(async () => view.mockInput.pressKey('m'));
    await act(async () => view.mockInput.pressKey('b'));
    const endFrame = await view.waitForFrame(
      (frame) => frame.includes('inline body') && frame.includes('i/m line')
    );
    expect(endFrame).toContain(
      'src/widget.ts:4-7 · reply to 88 · resolved · outdated'
    );
    expect(endFrame).toContain('Submitted review · reviewer');

    await act(async () => view.mockInput.pressKey('a'));
    const startFrame = await view.waitForFrame((frame) =>
      frame.includes('Pull request details · acme/widgets #7')
    );
    expect(startFrame).toContain('build · SUCCESS');
    await act(async () => view.mockInput.pressKey('v'));
    const descriptionFrame = await view.waitForFrame((frame) =>
      frame.includes('# literal **Markdown**')
    );
    expect(descriptionFrame).toContain('# literal **Markdown**');
    await act(async () => view.mockInput.pressKey('u'));
    view.renderer.destroy();
  });

  test('keeps successful sources visible and exposes unchanged failed-source diagnostics', async () => {
    const diagnostic = 'exact gh diagnostic\nsecond line';
    const issueFailure = {
      kind: 'exit',
      operation: 'pullRequestIssueComments',
      url: pullRequest.url,
      exitCode: 1,
      stderr: diagnostic,
    } as const;
    const loadPullRequestDetails = jest.fn(async () => ({
      metadata: success(pullRequestDetails('Available metadata')),
      reviews: success([]),
      checks: success([{ name: 'unit', state: 'FAILURE' }]),
      issueComments: { ok: false, failure: issueFailure } as const,
      inlineComments: success([]),
    }));
    const github = {
      async loadReviewQueue() {
        return success([pullRequest]);
      },
      loadPullRequestDetails,
      async submitReview() {
        throw new Error('Review Submission is not part of this page test');
      },
    } satisfies GitHub;
    const view = await testRender(reviewQueuePage(github), {
      width: 90,
      height: 28,
    });
    await view.waitForFrame((frame) => frame.includes('Improve widgets'));
    act(() => {
      view.mockInput.pressEnter();
    });
    const modal = await view.waitForFrame((frame) =>
      frame.includes('Issue comments unavailable')
    );
    expect(modal).toContain('unit · FAILURE');
    expect(modal).not.toContain(diagnostic);

    await act(async () => view.mockInput.pressKey('e'));
    const errors = await view.waitForFrame((frame) =>
      frame.includes('exact gh diagnostic')
    );
    expect(errors).toContain('second line');
    act(() => {
      view.mockInput.pressEscape();
    });
    await view.waitForFrame((frame) => !frame.includes('exact gh diagnostic'));
    await act(async () => {
      view.mockInput.pressKey('r');
      await Bun.sleep(20);
    });
    expect(loadPullRequestDetails).toHaveBeenCalledTimes(2);
    view.renderer.destroy();
  });

  test('the modal captures its target, owns input, and refetches on every opening', async () => {
    const loadPullRequestDetails = jest.fn(async (url: string) =>
      detailSources(
        pullRequestDetails(
          url === pullRequest.url ? 'First target' : 'Second target'
        )
      )
    );
    const openLumen = jest.fn(async () => ({ ok: true }) as const);
    const openReviewCommand = jest.fn(async () => ({ ok: true }) as const);
    const herdr = { openLumen, openReviewCommand } satisfies Herdr;
    const github = {
      async loadReviewQueue() {
        return success([pullRequest, secondPullRequest]);
      },
      loadPullRequestDetails,
      async submitReview() {
        throw new Error('Review Submission must stay closed');
      },
    } satisfies GitHub;
    const view = await testRender(reviewQueuePage(github, herdr), {
      width: 90,
      height: 24,
    });
    await view.waitForFrame((frame) => frame.includes('Improve widgets'));
    await act(async () => {
      view.mockInput.pressKey('e');
      view.mockInput.pressKey('d', { ctrl: true });
    });
    act(() => {
      view.mockInput.pressEnter();
    });
    const firstTargetFrame = await view.waitForFrame((frame) =>
      frame.includes('First target')
    );
    expect(firstTargetFrame).not.toContain('Review requests 2 open');
    await act(async () => {
      await view.mockInput.pressKey('j');
      await view.mockInput.pressKey('d');
      await view.mockInput.pressKey('c');
      await view.mockInput.pressKey('s');
    });
    expect(openLumen).not.toHaveBeenCalled();
    expect(openReviewCommand).not.toHaveBeenCalled();
    expect(view.captureCharFrame()).toContain('First target');

    act(() => {
      view.mockInput.pressEscape();
    });
    await view.waitForFrame((frame) =>
      frame.includes('Review requests 2 open')
    );
    await act(async () => {
      view.mockInput.pressEnter();
      await Bun.sleep(20);
    });
    await view.waitForFrame((frame) => frame.includes('First target'));
    expect(loadPullRequestDetails).toHaveBeenCalledTimes(2);
    expect(loadPullRequestDetails).toHaveBeenLastCalledWith(
      pullRequest.url,
      expect.any(AbortSignal)
    );

    act(() => {
      view.mockInput.pressEscape();
    });
    await view.waitForFrame((frame) =>
      frame.includes('Review requests 2 open')
    );
    await act(async () => view.mockInput.pressKey('j'));
    act(() => {
      view.mockInput.pressEnter();
    });
    await view.waitForFrame((frame) => frame.includes('Second target'));
    expect(loadPullRequestDetails).toHaveBeenLastCalledWith(
      secondPullRequest.url,
      expect.any(AbortSignal)
    );
    view.renderer.destroy();
  });
});

describe('Review Queue Herdr actions', () => {
  test('opens Lumen and the Review Command for the pull request under the Cursor', async () => {
    const github = {
      async loadReviewQueue() {
        return success([pullRequest, secondPullRequest]);
      },
      loadPullRequestDetails: pendingDetails,
      async submitReview() {
        throw new Error('Review Submission is not part of this page test');
      },
    } satisfies GitHub;
    const openLumen = jest.fn(async () => ({ ok: true }) as const);
    const openReviewCommand = jest.fn(async () => ({ ok: true }) as const);
    const herdr = { openLumen, openReviewCommand } satisfies Herdr;
    const view = await testRender(reviewQueuePage(github, herdr), {
      width: 100,
      height: 30,
    });
    await view.waitForFrame((frame) => frame.includes(secondPullRequest.title));
    await act(async () => view.mockInput.pressArrow('down'));

    await act(async () => view.mockInput.pressKey('d'));
    expect(openLumen).toHaveBeenCalledWith(secondPullRequest);
    await act(async () => view.mockInput.pressKey('c'));
    expect(openReviewCommand).toHaveBeenCalledWith(secondPullRequest);

    const unchanged = await view.waitForFrame(
      (frame) =>
        frame.includes(secondPullRequest.title) &&
        frame.includes(pullRequest.title)
    );
    expect(unchanged).toContain(secondPullRequest.title);
    view.renderer.destroy();
  });

  test('shows an immediate Herdr CLI failure and allows another action', async () => {
    const github = {
      async loadReviewQueue() {
        return success([pullRequest]);
      },
      loadPullRequestDetails: pendingDetails,
      async submitReview() {
        throw new Error('Review Submission is not part of this page test');
      },
    } satisfies GitHub;
    const failedAttempt = Promise.withResolvers<HerdrResult>();
    const openReviewCommand = jest
      .fn<Herdr['openReviewCommand']>()
      .mockReturnValueOnce(failedAttempt.promise)
      .mockResolvedValueOnce({ ok: true });
    const herdr = {
      async openLumen() {
        return { ok: true } as const;
      },
      openReviewCommand,
    } satisfies Herdr;
    const view = await testRender(reviewQueuePage(github, herdr), {
      width: 100,
      height: 30,
    });
    await view.waitForFrame((frame) => frame.includes(pullRequest.title));

    await act(async () => view.mockInput.pressKey('c'));
    await act(async () =>
      failedAttempt.resolve({
        ok: false,
        failure: {
          operation: 'createTab',
          message: 'Herdr CLI failed while trying to create a Herdr tab.',
          exitCode: 17,
          stderr: 'workspace unavailable',
        },
      })
    );
    const failure = await view.waitForFrame((frame) =>
      frame.includes('workspace unavailable')
    );
    expect(failure).toContain('Could not open Review Command');
    expect(failure).toContain('exit code');
    expect(failure).toContain('17)');
    expect(failure).toContain(`${pullRequest.repository} #7`);

    await act(async () => view.mockInput.pressKey('c'));
    const retried = await view.waitForFrame(
      (frame) => !frame.includes('Could not open Review Command')
    );
    expect(retried).toContain(`${pullRequest.repository} #7`);
    expect(openReviewCommand).toHaveBeenCalledTimes(2);
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
    const view = await testRender(reviewQueuePage(github), {
      width: 100,
      height: 30,
    });
    await view.waitForFrame((frame) => frame.includes(pullRequest.title));

    await act(async () => view.mockInput.pressKey('s'));
    const modal = await view.waitForFrame((frame) =>
      frame.includes('Tab decision Ctrl+S submit Esc cancel')
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
    expect(active).toContain('Submitting comment');
    await act(async () => submission.resolve(success(undefined)));
    const complete = await view.waitForFrame((frame) =>
      frame.includes('Commented on acme/widgets #7.')
    );
    expect(complete).not.toContain('Tab decision Ctrl+S submit Esc cancel');
    expect(loadReviewQueue).toHaveBeenCalledTimes(2);
    view.renderer.destroy();
  });

  test('focuses wrapped refresh diagnostics below a submission notice', async () => {
    let loadCount = 0;
    const loadReviewQueue = jest.fn(async () => {
      loadCount += 1;
      if (loadCount === 1) return success([pullRequest]);
      return {
        ok: false,
        failure: {
          kind: 'exit',
          operation: 'reviewQueue',
          exitCode: 1,
          stderr: `refresh-${'x'.repeat(45)}-TAIL`,
        },
      } as const;
    });
    const github = {
      loadReviewQueue,
      loadPullRequestDetails: pendingDetails,
      async submitReview() {
        return success(undefined);
      },
    } satisfies GitHub;
    const view = await testRender(reviewQueuePage(github), {
      width: 40,
      height: 30,
    });
    await view.waitForFrame((frame) => frame.includes(pullRequest.title));

    await act(async () => view.mockInput.pressKey('s'));
    await view.waitForFrame((frame) =>
      frame.includes('Review acme/widgets #7')
    );
    await act(async () => view.mockInput.pressArrow('down'));
    await act(async () => view.mockInput.typeText('Looks good'));
    await act(async () => view.mockInput.pressKey('s', { ctrl: true }));

    const failure = await view.waitForFrame((frame) =>
      frame.includes('Review Queue not refreshed')
    );
    expect(failure).toContain('refresh-');
    await act(async () => view.mockInput.pressKey('END'));
    await view.waitForFrame((frame) => frame.includes('TAIL'));
    expect(loadReviewQueue).toHaveBeenCalledTimes(2);
    view.renderer.destroy();
  });

  test('keeps an exact-fit refresh diagnostic below a wrapped notice', async () => {
    let loadCount = 0;
    const loadReviewQueue = jest.fn(async () => {
      loadCount += 1;
      if (loadCount === 1) return success([pullRequest]);
      return {
        ok: false,
        failure: {
          kind: 'exit',
          operation: 'reviewQueue',
          exitCode: 1,
          stderr: 'TAIL',
        },
      } as const;
    });
    const github = {
      loadReviewQueue,
      loadPullRequestDetails: pendingDetails,
      async submitReview() {
        return success(undefined);
      },
    } satisfies GitHub;
    const view = await testRender(reviewQueuePage(github), {
      width: 38,
      height: 30,
    });
    await view.waitForFrame((frame) => frame.includes(pullRequest.title));

    await act(async () => view.mockInput.pressKey('s'));
    await view.waitForFrame((frame) =>
      frame.includes('Review acme/widgets #7')
    );
    await act(async () => view.mockInput.pressArrow('down'));
    await act(async () => view.mockInput.typeText('Looks good'));
    await act(async () => view.mockInput.pressKey('s', { ctrl: true }));

    const complete = await view.waitForFrame((frame) => frame.includes('TAIL'));
    expect(complete).toContain('Commented on');
    expect(complete).not.toContain('PgUp/PgDn');
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
    const view = await testRender(reviewQueuePage(github), {
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
    const view = await testRender(reviewQueuePage(github), {
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
    const view = await testRender(reviewQueuePage(github), {
      width: 100,
      height: 30,
      kittyKeyboard: true,
    });
    await view.waitForFrame((frame) => frame.includes(pullRequest.title));

    await act(async () => view.mockInput.pressKey('s'));
    await view.waitForFrame((frame) =>
      frame.includes('Tab decision Ctrl+S submit Esc cancel')
    );
    await act(view.mockInput.pressEscape);
    await view.waitForFrame(
      (frame) => !frame.includes('Tab decision Ctrl+S submit Esc cancel')
    );

    await act(async () => view.mockInput.pressKey('s'));
    await view.waitForFrame((frame) =>
      frame.includes('Tab decision Ctrl+S submit Esc cancel')
    );
    await act(async () => view.mockInput.typeText('Draft'));
    await act(view.mockInput.pressEscape);
    const confirmation = await view.waitForFrame((frame) =>
      frame.includes('Discard this Review Submission?')
    );
    expect(confirmation).toContain('[x]');
    expect(confirmation).toContain('Keep editing');
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
    expect(reopenedConfirmation).toContain('[x]');
    expect(reopenedConfirmation).toContain('Keep editing');
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
      (frame) => !frame.includes('Discard this Review Submission?')
    );
    expect(discarded).toContain('acme/widgets #7');
    expect(submitReview).not.toHaveBeenCalled();
    view.renderer.destroy();
  });
});
