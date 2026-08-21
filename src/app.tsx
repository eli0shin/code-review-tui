import { createCliRenderer } from '@opentui/core';
import { createRoot, useKeyboard } from '@opentui/react';
import {
  environmentManager,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { useState } from 'react';
import type { PullRequestDetails, ReviewQueue } from './domain/pull-request.ts';
import type { GitHub, GitHubFailure } from './github/types.ts';

environmentManager.setIsServer(() => false);

const refreshIntervalMs = 60_000;
const detailsQueryKey = ['pullRequestDetails'] as const;
const emptyReviewQueue: ReviewQueue = [];

type ReviewQueuePageProps = {
  readonly github: GitHub;
};

export function ReviewQueuePage({ github }: ReviewQueuePageProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { gcTime: Infinity, retry: false },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ReviewQueue github={github} />
    </QueryClientProvider>
  );
}

function ReviewQueue({ github }: ReviewQueuePageProps) {
  const [cursor, setCursor] = useState(0);
  const queueQuery = useQuery<ReviewQueue, GitHubFailure>({
    queryKey: ['reviewQueue'],
    async queryFn({ signal }) {
      const result = await github.loadReviewQueue(signal);
      if (!result.ok) throw result.failure;
      return result.value;
    },
    refetchInterval: refreshIntervalMs,
  });
  const queue = queueQuery.data ?? emptyReviewQueue;
  const cursorPosition =
    queue.length === 0 ? 0 : Math.min(cursor, queue.length - 1);
  const highlightedPullRequest = queue.at(cursorPosition);
  const detailsUrl = highlightedPullRequest?.url;

  const detailsQuery = useQuery<PullRequestDetails, GitHubFailure>({
    queryKey: [...detailsQueryKey, detailsUrl],
    enabled: detailsUrl !== undefined,
    async queryFn({ signal }) {
      if (detailsUrl === undefined) {
        throw new Error('A highlighted pull request URL is required');
      }
      const result = await github.loadPullRequestDetails(detailsUrl, signal);
      if (!result.ok) throw result.failure;
      return result.value;
    },
  });

  useKeyboard((key) => {
    if (key.name === 'r') {
      void queueQuery.refetch();
      return;
    }

    const offset = key.name === 'down' ? 1 : key.name === 'up' ? -1 : 0;
    if (offset === 0) return;
    const nextPosition = cursorPosition + offset;
    if (nextPosition < 0 || nextPosition >= queue.length) return;
    setCursor(nextPosition);
  });

  return (
    <box flexDirection="column">
      <text>Review Queue</text>
      {queueQuery.status === 'pending' ? (
        <text>Loading pull requests…</text>
      ) : null}
      {queueQuery.status === 'error' ? (
        <text>
          Could not load pull requests: {failureMessage(queueQuery.error)}
        </text>
      ) : null}
      {queueQuery.status === 'success' && queueQuery.isFetching ? (
        <text>Loading pull requests…</text>
      ) : null}
      {queueQuery.status === 'success' && queue.length === 0 ? (
        <text>No pull requests need your review.</text>
      ) : null}
      {queue.map((pullRequest, index) => (
        <text key={pullRequest.url}>
          {index === cursorPosition ? '› ' : '  '}
          {pullRequest.repository}#{pullRequest.number} {pullRequest.title}
        </text>
      ))}
      {detailsUrl !== undefined && detailsQuery.status === 'pending' ? (
        <text>Loading pull request details…</text>
      ) : null}
      {detailsQuery.status === 'error' ? (
        <text>
          Could not load pull request details:{' '}
          {failureMessage(detailsQuery.error)}
        </text>
      ) : null}
      {detailsQuery.data ? (
        <box flexDirection="column">
          <text>{detailsQuery.data.title}</text>
          <text>{detailsQuery.data.body}</text>
        </box>
      ) : null}
    </box>
  );
}

export function App() {
  return <text>Review Queue</text>;
}

export async function launchApplication(): Promise<void> {
  const renderer = await createCliRenderer();
  createRoot(renderer).render(<App />);
}

function failureMessage(failure: GitHubFailure): string {
  switch (failure.kind) {
    case 'startup':
      return failure.diagnostic;
    case 'malformedData':
    case 'incompatibleData':
      return failure.stderr
        ? `${failure.diagnostic}\n${failure.stderr}`
        : failure.diagnostic;
    case 'exit':
      return failure.stderr || `gh exited with code ${failure.exitCode}`;
    case 'interrupted': {
      const diagnostic = failure.diagnostic || failure.reason;
      return failure.stderr ? `${diagnostic}\n${failure.stderr}` : diagnostic;
    }
  }
}
