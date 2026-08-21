import { createCliRenderer } from '@opentui/core';
import { createRoot, useKeyboard } from '@opentui/react';
import { useCallback, useEffect, useState } from 'react';
import type { PullRequestDetails, ReviewQueue } from './domain/pull-request.ts';
import type { GitHub, GitHubFailure } from './github/types.ts';

const refreshIntervalMs = 60_000;

type ReviewQueuePageProps = {
  readonly github: GitHub;
};

export function ReviewQueuePage({ github }: ReviewQueuePageProps) {
  const [queue, setQueue] = useState<ReviewQueue>([]);
  const [selectedUrl, setSelectedUrl] = useState<string>();
  const [details, setDetails] = useState<PullRequestDetails>();
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [queueFailure, setQueueFailure] = useState<GitHubFailure>();
  const [detailsFailure, setDetailsFailure] = useState<GitHubFailure>();

  const loadPullRequests = useCallback(async () => {
    setLoadingQueue(true);
    setQueueFailure(undefined);

    const result = await github.loadReviewQueue(new AbortController().signal);
    setLoadingQueue(false);
    if (!result.ok) {
      setQueueFailure(result.failure);
      return;
    }

    setQueue(result.value);
    setSelectedUrl((currentUrl) =>
      currentUrl !== undefined &&
      result.value.some((pullRequest) => pullRequest.url === currentUrl)
        ? currentUrl
        : result.value.at(0)?.url
    );
  }, [github]);

  useEffect(() => {
    void loadPullRequests();
    const refreshTimer = setInterval(() => {
      void loadPullRequests();
    }, refreshIntervalMs);

    return () => clearInterval(refreshTimer);
  }, [loadPullRequests]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadSelectedDetails() {
      setDetails(undefined);
      setDetailsFailure(undefined);
      if (selectedUrl === undefined) {
        setLoadingDetails(false);
        return;
      }

      setLoadingDetails(true);
      const result = await github.loadPullRequestDetails(
        selectedUrl,
        controller.signal
      );
      if (!active) return;
      setLoadingDetails(false);
      if (result.ok) setDetails(result.value);
      else setDetailsFailure(result.failure);
    }

    void loadSelectedDetails();
    return () => {
      active = false;
      controller.abort();
    };
  }, [github, selectedUrl]);

  useKeyboard((key) => {
    if (key.name === 'r') {
      void loadPullRequests();
      return;
    }

    const offset = key.name === 'down' ? 1 : key.name === 'up' ? -1 : 0;
    if (offset === 0) return;
    setSelectedUrl((currentUrl) => {
      const currentIndex = queue.findIndex(
        (pullRequest) => pullRequest.url === currentUrl
      );
      return queue[currentIndex + offset]?.url ?? currentUrl;
    });
  });

  return (
    <box flexDirection="column">
      <text>Review Queue</text>
      {loadingQueue ? <text>Loading pull requests…</text> : null}
      {queueFailure ? (
        <text>
          Could not load pull requests: {failureMessage(queueFailure)}
        </text>
      ) : null}
      {!loadingQueue && !queueFailure && queue.length === 0 ? (
        <text>No pull requests need your review.</text>
      ) : null}
      {queue.map((pullRequest) => (
        <text key={pullRequest.url}>
          {pullRequest.url === selectedUrl ? '› ' : '  '}
          {pullRequest.repository}#{pullRequest.number} {pullRequest.title}
        </text>
      ))}
      {loadingDetails ? <text>Loading pull request details…</text> : null}
      {detailsFailure ? (
        <text>
          Could not load pull request details: {failureMessage(detailsFailure)}
        </text>
      ) : null}
      {details ? (
        <box flexDirection="column">
          <text>{details.title}</text>
          <text>{details.body}</text>
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
    case 'malformedData':
    case 'incompatibleData':
      return failure.diagnostic;
    case 'exit':
      return failure.stderr || `gh exited with code ${failure.exitCode}`;
    case 'interrupted':
      return failure.diagnostic || failure.stderr || failure.reason;
  }
}
