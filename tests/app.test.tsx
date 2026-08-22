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
import type { GitHub, GitHubResult } from '../src/github/types.ts';
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
  openDiff: ['d', 'enter'],
  runReviewCommand: ['c'],
  composeReviewSubmission: ['s'],
  refresh: ['r'],
  showHelp: ['?'],
  quit: ['q'],
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

    const view = await testRender(reviewQueuePage(github), {
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

  test('renders the accepted Review Queue hierarchy and Cursor details', async () => {
    const github = {
      async loadReviewQueue() {
        return success([pullRequest, secondPullRequest]);
      },
      async loadPullRequestDetails(url: string) {
        const request =
          url === secondPullRequest.url ? secondPullRequest : pullRequest;
        return success(
          pullRequestDetails(
            request === secondPullRequest
              ? 'Second row details'
              : 'Improve widgets',
            request
          )
        );
      },
      async submitReview() {
        throw new Error('Review Submission is not part of this page test');
      },
    } satisfies GitHub;
    const view = await testRender(reviewQueuePage(github), {
      width: 110,
      height: 32,
    });

    const frame = await view.waitForFrame(
      (renderedFrame) =>
        renderedFrame.includes('Review requests 2 open') &&
        renderedFrame.includes('Pull request details')
    );
    expect(frame).toContain('● Improve widgets');
    expect(frame).toContain('acme/widgets #7 opened by octocat');
    expect(frame).toContain('● Add more widgets');
    const metadataRows = frame
      .split('\n')
      .filter((line) => line.includes('1 file +10 -2 · 3 comments · review'));
    expect(metadataRows).toHaveLength(2);
    expect(frame).toContain('main ← widgets');
    expect(frame).toContain('1 file  +10 -2');
    expect(frame).toContain('Pull request body');
    expect(frame).toContain(
      'j/k move  d/enter diff  c review command  s submit review  ? help'
    );

    await act(async () => view.mockInput.pressArrow('down'));
    const movedFrame = await view.waitForFrame((renderedFrame) =>
      renderedFrame.includes('Second row details')
    );
    expect(
      movedFrame
        .split('\n')
        .filter((line) => line.includes('1 file +10 -2 · 3 comments · review'))
    ).toHaveLength(2);

    view.renderer.destroy();
  });

  test('keeps the Cursor visible in a bounded small-terminal viewport', async () => {
    const queue = Array.from({ length: 6 }, (_, index) => ({
      ...pullRequest,
      url: `https://github.com/acme/widgets/pull/${index + 7}`,
      number: index + 7,
      title: `Queue item ${index + 7}`,
    }));
    const github = {
      async loadReviewQueue() {
        return success(queue);
      },
      async loadPullRequestDetails(url: string) {
        const request = queue.find((item) => item.url === url);
        if (request === undefined) throw new Error('Unknown pull request');
        return success(
          pullRequestDetails(`Details #${request.number}`, request)
        );
      },
      async submitReview() {
        throw new Error('Review Submission is not part of this page test');
      },
    } satisfies GitHub;
    const view = await testRender(reviewQueuePage(github), {
      width: 100,
      height: 30,
    });
    await view.waitForFrame((frame) => frame.includes('Details #7'));

    for (let index = 0; index < 5; index += 1) {
      await act(async () => view.mockInput.pressKey('j'));
    }
    const finalFrame = await view.waitForFrame((frame) =>
      frame.includes('Details #12')
    );
    expect(finalFrame).toContain('Queue item 12');
    expect(finalFrame).not.toContain('Queue item 7');
    expect(finalFrame).toContain('Pull request details');
    expect(finalFrame).toContain('j/k move');

    await act(async () => {
      view.resize(100, 16);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await view.renderOnce();
    });
    const resizedFrame = await view.waitForFrame(
      (frame) =>
        frame.includes('Details #12') && frame.includes('Queue item 12')
    );
    expect(resizedFrame).not.toContain('Queue item 7');
    view.renderer.destroy();
  });

  test('keeps a long refresh failure focused while its binding can retry', async () => {
    const queue = Array.from({ length: 6 }, (_, index) => ({
      ...pullRequest,
      url: `https://github.com/acme/widgets/pull/${index + 7}`,
      number: index + 7,
      title: `Queue item ${index + 7}`,
    }));
    let loadCount = 0;
    const loadReviewQueue = jest.fn(async () => {
      loadCount += 1;
      if (loadCount === 1 || loadCount === 3) return success(queue);
      return {
        ok: false,
        failure: {
          kind: 'exit',
          operation: 'reviewQueue',
          exitCode: 1,
          stderr: `stderr-one\nstderr-two\nstderr-three\nstderr-four\nstderr-five\nstderr-six\nstderr-seven\nstderr-eight-${'x'.repeat(100)}-queue-tail`,
        },
      } as const;
    });
    const github = {
      loadReviewQueue,
      loadPullRequestDetails: jest.fn(async (url: string) => {
        const request = queue.find((item) => item.url === url);
        if (request === undefined) throw new Error('Unknown pull request');
        return success(
          pullRequestDetails(`Details #${request.number}`, request)
        );
      }),
      async submitReview() {
        throw new Error('Review Submission is not part of this page test');
      },
    } satisfies GitHub;
    const view = await testRender(
      reviewQueuePage(github, unusedHerdr, {
        ...defaultKeyBindings,
        refresh: ['f5'],
      }),
      {
        width: 100,
        height: 16,
        kittyKeyboard: true,
      }
    );
    await view.waitForFrame((frame) => frame.includes('Details #7'));
    for (let index = 0; index < 5; index += 1) {
      await act(async () => view.mockInput.pressKey('j'));
    }
    await view.waitForFrame((frame) => frame.includes('Details #12'));

    await act(async () => view.mockInput.pressKey('F5'));
    const failedFrame = await view.waitForFrame((frame) =>
      frame.includes('Review Queue not refreshed')
    );
    expect(failedFrame).toContain('stderr-one');
    await act(async () => view.mockInput.pressKey('k'));
    expect(github.loadPullRequestDetails).toHaveBeenLastCalledWith(
      queue[5]?.url,
      expect.any(AbortSignal)
    );

    await act(async () => view.mockInput.pressKey('END'));
    await view.waitForFrame((frame) => frame.includes('queue-tail'));
    await act(async () => view.mockInput.pressKey('F5'));
    await view.waitForFrame(
      (frame) => !frame.includes('PgUp/PgDn page Home/End Esc return')
    );
    expect(loadReviewQueue).toHaveBeenCalledTimes(3);
    await act(async () => view.mockInput.pressKey('k'));
    await view.waitForFrame((frame) => frame.includes('Details #11'));
    view.renderer.destroy();
  });

  test('focuses a single diagnostic line that wraps past narrow inline space', async () => {
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
          stderr: `single-line-${'\t'.repeat(40)}-narrow-tail-END`,
        },
      } as const;
    });
    const github = {
      loadReviewQueue,
      async loadPullRequestDetails() {
        return success(pullRequestDetails('Details #7'));
      },
      async submitReview() {
        throw new Error('Review Submission is not part of this page test');
      },
    } satisfies GitHub;
    const view = await testRender(reviewQueuePage(github), {
      width: 40,
      height: 16,
    });
    await view.waitForFrame((frame) => frame.includes('Details #7'));

    await act(async () => view.mockInput.pressKey('r'));
    const failure = await view.waitForFrame((frame) =>
      frame.includes('Review Queue not refreshed')
    );
    expect(failure).toContain('single-line');
    await act(async () => view.mockInput.pressKey('END'));
    await view.waitForFrame((frame) => frame.includes('tail-END'));
    expect(loadReviewQueue).toHaveBeenCalledTimes(2);
    view.renderer.destroy();
  });

  test('uses effective keys only while the Review Queue owns input', async () => {
    const loadPullRequestDetails = jest.fn(async (url: string) =>
      success(
        pullRequestDetails(
          url === pullRequest.url ? 'First details' : 'Second details',
          url === pullRequest.url ? pullRequest : secondPullRequest
        )
      )
    );
    const github = {
      async loadReviewQueue() {
        return success([pullRequest, secondPullRequest]);
      },
      loadPullRequestDetails,
      async submitReview() {
        throw new Error('Review Submission is not part of this page test');
      },
    } satisfies GitHub;
    const openReviewCommand = jest.fn(async () => ({ ok: true }) as const);
    const herdr = {
      async openLumen() {
        return { ok: true } as const;
      },
      openReviewCommand,
    } satisfies Herdr;
    const bindings = {
      selectPrevious: ['p'],
      selectNext: ['n'],
      openDiff: ['x'],
      runReviewCommand: ['alt+shift+a'],
      composeReviewSubmission: ['w'],
      refresh: ['f'],
      showHelp: ['h'],
      quit: ['z'],
    } satisfies EffectiveKeyBindings;
    const onQuit = jest.fn();
    const view = await testRender(
      reviewQueuePage(github, herdr, bindings, onQuit),
      {
        width: 110,
        height: 32,
      }
    );
    await view.waitForFrame((frame) => frame.includes('First details'));

    await act(async () => view.mockInput.pressArrow('down'));
    const unchangedByDefaultKey = await view.waitForFrame((frame) =>
      frame.includes('First details')
    );
    expect(unchangedByDefaultKey).not.toContain('Second details');
    await act(async () => view.mockInput.pressKey('h'));
    const help = await view.waitForFrame((frame) =>
      frame.includes('Review Queue keys')
    );
    expect(help).toContain('x  open diff');
    expect(help).toContain('alt+shift+a  run Review Command');
    await act(async () => view.mockInput.pressKey('n'));
    expect(view.captureCharFrame()).toContain('Review Queue keys');
    expect(view.captureCharFrame()).not.toContain('Second details');

    await act(async () => view.mockInput.pressKey('h'));
    await act(async () => view.mockInput.pressKey('n'));
    await view.waitForFrame((frame) => frame.includes('Second details'));
    expect(loadPullRequestDetails).toHaveBeenLastCalledWith(
      secondPullRequest.url,
      expect.any(AbortSignal)
    );
    await act(async () =>
      view.mockInput.pressKey('A', { meta: true, shift: true })
    );
    expect(openReviewCommand).toHaveBeenCalledWith(secondPullRequest);
    await act(async () => view.mockInput.pressKey('z'));
    expect(onQuit).toHaveBeenCalledTimes(1);
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
    const requests = [pullRequest, secondPullRequest, thirdPullRequest];
    const github = {
      loadReviewQueue() {
        const queueLoad = queueLoads[queueLoadIndex];
        queueLoadIndex += 1;
        return queueLoad;
      },
      async loadPullRequestDetails(url: string) {
        const request = requests.find((item) => item.url === url);
        if (request === undefined) throw new Error('Unknown pull request');
        return success(
          pullRequestDetails(`Details #${request.number}`, request)
        );
      },
      async submitReview() {
        throw new Error('Review Submission is not part of this page test');
      },
    } satisfies GitHub;

    const view = await testRender(reviewQueuePage(github), {
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
    await view.waitForFrame((frame) => frame.includes('Details #9'));

    await act(async () => view.mockInput.pressKey('r'));
    await act(async () =>
      shorterQueue.resolve(success([pullRequest, secondPullRequest]))
    );
    await view.waitForFrame((frame) => frame.includes('Details #8'));

    await act(async () => view.mockInput.pressKey('r'));
    await act(async () =>
      longerQueue.resolve(
        success([pullRequest, secondPullRequest, thirdPullRequest])
      )
    );
    const restoredQueueFrame = await view.waitForFrame(
      (frame) =>
        frame.includes('Details #8') && frame.includes(thirdPullRequest.title)
    );
    expect(restoredQueueFrame).not.toContain('Details #9');
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      configurable: true,
      value: false,
    });
    view.renderer.destroy();
  });

  test('keeps short failures inline and lets the queue retry', async () => {
    const queueLoad = Promise.withResolvers<GitHubResult<ReviewQueue>>();
    let loadCount = 0;
    const loadReviewQueue = jest.fn(() => {
      loadCount += 1;
      return loadCount === 1
        ? queueLoad.promise
        : Promise.resolve(success([pullRequest]));
    });
    const github = {
      loadReviewQueue,
      async loadPullRequestDetails() {
        return success(pullRequestDetails('Details #7'));
      },
      async submitReview() {
        throw new Error('Review Submission is not part of this page test');
      },
    } satisfies GitHub;

    const view = await testRender(reviewQueuePage(github), {
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
    expect(frame).not.toContain('PgUp/PgDn page Home/End Esc return');
    await act(async () => view.mockInput.pressKey('r'));
    await view.waitForFrame((renderedFrame) =>
      renderedFrame.includes('Details #7')
    );
    expect(loadReviewQueue).toHaveBeenCalledTimes(2);
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      configurable: true,
      value: false,
    });
    view.renderer.destroy();
  });

  test('makes long detail stderr reachable without running queue actions', async () => {
    const submitReview = jest.fn(async () => success(undefined));
    const github = {
      async loadReviewQueue() {
        return success([pullRequest]);
      },
      async loadPullRequestDetails() {
        return {
          ok: false,
          failure: {
            kind: 'exit',
            operation: 'pullRequestDetails',
            url: pullRequest.url,
            exitCode: 1,
            stderr: `detail-one\ndetail-two\ndetail-three\ndetail-four\ndetail-five\ndetail-six\ndetail-seven\ndetail-eight-${'x'.repeat(100)}-detail-tail`,
          },
        } as const;
      },
      submitReview,
    } satisfies GitHub;
    const view = await testRender(reviewQueuePage(github), {
      width: 80,
      height: 16,
      kittyKeyboard: true,
    });
    const failure = await view.waitForFrame((frame) =>
      frame.includes('Pull request details unavailable')
    );
    expect(failure).toContain('detail-one');

    await act(async () => view.mockInput.pressKey('s'));
    expect(view.captureCharFrame()).not.toContain('Ctrl+S submit');
    expect(submitReview).not.toHaveBeenCalled();
    await act(async () => view.mockInput.pressKey('END'));
    await view.waitForFrame((frame) => frame.includes('detail-tail'));

    await act(async () => {
      view.mockInput.pressEscape();
      await Promise.resolve();
    });
    await view.waitForFrame(
      (frame) => !frame.includes('PgUp/PgDn page Home/End Esc return')
    );
    await act(async () => view.mockInput.pressKey('s'));
    await view.waitForFrame((frame) =>
      frame.includes('Review acme/widgets #7')
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
