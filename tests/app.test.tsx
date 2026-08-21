import { afterEach, describe, expect, jest, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';
import { act } from 'react';
import { App, ReviewQueuePage } from '../src/app.tsx';
import type { GitHub } from '../src/github/types.ts';

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
});
