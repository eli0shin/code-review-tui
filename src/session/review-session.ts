import type {
  PullRequestDetails,
  ReviewQueue,
} from '../domain/pull-request.ts';
import type { GitHub, GitHubFailure } from '../github/types.ts';

export type QueueLoadState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'initialLoading' }
  | { readonly phase: 'refreshing' }
  | {
      readonly phase: 'failed';
      readonly load: 'initial' | 'refresh';
      readonly failure: GitHubFailure;
    };

export type PullRequestDetailsState =
  | { readonly phase: 'idle' }
  | {
      readonly phase: 'loading';
      readonly url: string;
      readonly staleValue?: PullRequestDetails;
    }
  | {
      readonly phase: 'ready';
      readonly url: string;
      readonly value: PullRequestDetails;
    }
  | {
      readonly phase: 'failed';
      readonly url: string;
      readonly failure: GitHubFailure;
    };

export type ReviewSnapshot = {
  readonly queue: ReviewQueue;
  readonly queueLoad: QueueLoadState;
  readonly selectedUrl: string | undefined;
  readonly details: PullRequestDetailsState;
};

export type ReviewAction =
  | { readonly type: 'refresh' }
  | { readonly type: 'selectNext' }
  | { readonly type: 'selectPrevious' }
  | { readonly type: 'select'; readonly url: string };

export type ReviewSession = {
  start(): Promise<void>;
  getSnapshot(): ReviewSnapshot;
  dispatch(action: ReviewAction): void;
  subscribe(listener: () => void): () => void;
};

export function createReviewSession(github: GitHub): ReviewSession {
  let snapshot = initialSnapshot();
  let started = false;
  let hasLoadedQueue = false;
  let queueActive = false;
  let queuePending = false;
  let queueRun: Promise<void> | undefined;
  let detailRequest = 0;
  let detailController: AbortController | undefined;
  const listeners = new Set<() => void>();

  function publish(change: Partial<ReviewSnapshot>): void {
    snapshot = { ...snapshot, ...change };
    for (const listener of [...listeners]) listener();
  }

  function requestQueueLoad(): Promise<void> {
    if (queueActive) {
      queuePending = true;
      return queueRun ?? Promise.resolve();
    }

    queueActive = true;
    queueRun = runQueueLoads();
    return queueRun;
  }

  async function runQueueLoads(): Promise<void> {
    try {
      for (;;) {
        queuePending = false;
        publish({
          queueLoad: hasLoadedQueue
            ? { phase: 'refreshing' }
            : { phase: 'initialLoading' },
        });

        const result = await github.loadReviewQueue(
          new AbortController().signal
        );
        if (!result.ok) {
          publish({
            queueLoad: {
              phase: 'failed',
              load: hasLoadedQueue ? 'refresh' : 'initial',
              failure: result.failure,
            },
          });
        } else {
          hasLoadedQueue = true;
          replaceQueue(result.value);
        }

        if (!takePendingQueueLoad()) return;
      }
    } finally {
      queueActive = false;
      queueRun = undefined;
    }
  }

  function takePendingQueueLoad(): boolean {
    const pending = queuePending;
    queuePending = false;
    return pending;
  }

  function replaceQueue(nextQueue: ReviewQueue): void {
    const queue = [...nextQueue];
    const selectedUrl = selectAfterReplacement(queue);
    const selectionChanged = selectedUrl !== snapshot.selectedUrl;

    if (selectedUrl === undefined) {
      obsoleteDetails();
      publish({
        queue,
        queueLoad: { phase: 'idle' },
        selectedUrl: undefined,
        details: { phase: 'idle' },
      });
      return;
    }

    const staleValue =
      selectionChanged || snapshot.details.phase === 'idle'
        ? undefined
        : detailValue(snapshot.details);
    if (selectionChanged) obsoleteDetails();
    const detailRequestBeforePublish = detailRequest;
    publish({
      queue,
      queueLoad: { phase: 'idle' },
      selectedUrl,
      ...(selectionChanged ? { details: { phase: 'idle' } } : {}),
    });
    if (
      snapshot.selectedUrl !== selectedUrl ||
      detailRequest !== detailRequestBeforePublish
    ) {
      return;
    }
    loadDetails(selectedUrl, staleValue);
  }

  function selectAfterReplacement(queue: ReviewQueue): string | undefined {
    if (queue.length === 0) return undefined;
    if (
      snapshot.selectedUrl !== undefined &&
      queue.some((pullRequest) => pullRequest.url === snapshot.selectedUrl)
    ) {
      return snapshot.selectedUrl;
    }
    return queue.at(0)?.url;
  }

  function loadDetails(
    url: string,
    staleValue: PullRequestDetails | undefined = undefined
  ): void {
    detailController?.abort();
    const controller = new AbortController();
    detailController = controller;
    const request = ++detailRequest;
    publish({
      details:
        staleValue === undefined
          ? { phase: 'loading', url }
          : { phase: 'loading', url, staleValue },
    });
    if (request !== detailRequest || snapshot.selectedUrl !== url) return;

    void github
      .loadPullRequestDetails(url, controller.signal)
      .then((result) => {
        if (request !== detailRequest || snapshot.selectedUrl !== url) return;
        detailController = undefined;
        if (result.ok) {
          publish({ details: { phase: 'ready', url, value: result.value } });
        } else {
          publish({
            details: { phase: 'failed', url, failure: result.failure },
          });
        }
      });
  }

  function obsoleteDetails(): void {
    detailController?.abort();
    detailController = undefined;
    detailRequest += 1;
  }

  function select(url: string): void {
    if (!snapshot.queue.some((pullRequest) => pullRequest.url === url)) return;
    const changed = snapshot.selectedUrl !== url;
    if (changed) {
      obsoleteDetails();
      const detailRequestBeforePublish = detailRequest;
      publish({ selectedUrl: url, details: { phase: 'idle' } });
      if (
        snapshot.selectedUrl !== url ||
        detailRequest !== detailRequestBeforePublish
      ) {
        return;
      }
    }
    loadDetails(url, changed ? undefined : detailValue(snapshot.details));
  }

  function moveSelection(offset: -1 | 1): void {
    if (snapshot.selectedUrl === undefined) return;
    const index = snapshot.queue.findIndex(
      (pullRequest) => pullRequest.url === snapshot.selectedUrl
    );
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= snapshot.queue.length) return;
    select(snapshot.queue[nextIndex].url);
  }

  return {
    start() {
      if (started) return queueRun ?? Promise.resolve();
      started = true;
      return requestQueueLoad();
    },

    getSnapshot() {
      return snapshot;
    },

    dispatch(action) {
      if (!started) return;
      switch (action.type) {
        case 'refresh':
          void requestQueueLoad();
          break;
        case 'selectNext':
          moveSelection(1);
          break;
        case 'selectPrevious':
          moveSelection(-1);
          break;
        case 'select':
          select(action.url);
          break;
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function initialSnapshot(): ReviewSnapshot {
  return {
    queue: [],
    queueLoad: { phase: 'idle' },
    selectedUrl: undefined,
    details: { phase: 'idle' },
  };
}

function detailValue(
  state: PullRequestDetailsState
): PullRequestDetails | undefined {
  if (state.phase === 'ready') return state.value;
  if (state.phase === 'loading') return state.staleValue;
  return undefined;
}
