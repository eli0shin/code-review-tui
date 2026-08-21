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
  const [selectedUrl, setSelectedUrl] = useState<string>();
  const queueQuery = useQuery<ReviewQueue, GitHubFailure>({
    queryKey: ['reviewQueue'],
    async queryFn({ signal }) {
      const result = await github.loadReviewQueue(signal);
      if (!result.ok) throw result.failure;
      return result.value;
    },
    refetchInterval: refreshIntervalMs,
  });
  const queue = queueQuery.data ?? [];
  const effectiveSelectedUrl =
    queue.find((pullRequest) => pullRequest.url === selectedUrl)?.url ??
    queue.at(0)?.url;
  const detailsQuery = useQuery<PullRequestDetails, GitHubFailure>({
    queryKey: [...detailsQueryKey, effectiveSelectedUrl],
    enabled: effectiveSelectedUrl !== undefined,
    async queryFn({ signal }) {
      if (effectiveSelectedUrl === undefined) {
        throw new Error('A selected pull request URL is required');
      }
      const result = await github.loadPullRequestDetails(
        effectiveSelectedUrl,
        signal
      );
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
    const currentIndex = queue.findIndex(
      (pullRequest) => pullRequest.url === effectiveSelectedUrl
    );
    const nextIndex = currentIndex + offset;
    if (nextIndex < 0 || nextIndex >= queue.length) return;
    setSelectedUrl(queue[nextIndex].url);
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
      {queue.map((pullRequest) => (
        <text key={pullRequest.url}>
          {pullRequest.url === effectiveSelectedUrl ? '› ' : '  '}
          {pullRequest.repository}#{pullRequest.number} {pullRequest.title}
        </text>
      ))}
      {effectiveSelectedUrl !== undefined &&
      detailsQuery.status === 'pending' ? (
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
