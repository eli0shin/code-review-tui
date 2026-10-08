import { useTerminalDimensions } from '@opentui/react';
import {
  environmentManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { useState } from 'react';
import type { EffectiveKeyBindings } from '../../configuration/index.ts';
import type { PullRequestSummary } from '../../domain/pull-request.ts';
import type { CurrentRepositoryResult } from '../../github/current-repository.ts';
import type { GitHub } from '../../github/types.ts';
import type { Herdr } from '../../tools/types.ts';
import { usePullRequestDetails } from '../details/use-pull-request-details.ts';
import { useReviewSubmission } from '../submission/use-review-submission.ts';
import { useCopyCompletedSelection } from '../terminal/selection.ts';
import { useSystemTheme } from '../terminal/theme.ts';
import { QueueOverlays } from './overlays.tsx';
import { ReviewQueueScreen } from './screen.tsx';
import { useQueueFeedback } from './use-queue-feedback.ts';
import { useQueueKeyboard } from './use-queue-keyboard.ts';
import { useQueueSearch } from './use-queue-search.ts';
import { useRepositoryScope } from './use-repository-scope.ts';
import { useReviewQueue } from './use-review-queue.ts';

environmentManager.setIsServer(() => false);

type ReviewQueuePageProps = {
  readonly github: GitHub;
  readonly herdr: Herdr;
  readonly keyBindings: EffectiveKeyBindings;
  readonly refreshIntervalMinutes: number;
  readonly githubSearchText: string;
  readonly pageSize?: number;
  readonly loadCurrentRepository?: (
    signal: AbortSignal
  ) => Promise<CurrentRepositoryResult>;
  readonly onQuit: () => void;
};

export function ReviewQueuePage(props: ReviewQueuePageProps) {
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
      <ReviewQueue {...props} />
    </QueryClientProvider>
  );
}

function ReviewQueue({
  github,
  herdr,
  keyBindings,
  refreshIntervalMinutes,
  githubSearchText,
  pageSize = 25,
  loadCurrentRepository,
  onQuit,
}: ReviewQueuePageProps) {
  const theme = useSystemTheme();
  useCopyCompletedSelection(theme);
  const terminal = useTerminalDimensions();
  const repositoryScope = useRepositoryScope(loadCurrentRepository);
  const reviewQueue = useReviewQueue({
    github,
    githubSearchText,
    refreshIntervalMinutes,
    pageSize,
    repository: repositoryScope.repository,
  });
  const feedback = useQueueFeedback({
    github,
    herdr,
    reviewQueue,
    scopeDiagnostic: repositoryScope.diagnostic,
    terminal,
    keyBindings,
  });
  const details = usePullRequestDetails(github);
  const submission = useReviewSubmission(github, () => {
    feedback.clearNotice();
    void reviewQueue.query.refetch();
  });
  const searchEditor = useQueueSearch(reviewQueue, feedback.reset);
  const [helpOpen, setHelpOpen] = useState(false);
  const activeFailure =
    searchEditor.draft === undefined && details.target === undefined
      ? feedback.failureOverlay
      : undefined;

  function refreshFromStart(): void {
    feedback.clearNotice();
    reviewQueue.refreshFromStart();
  }

  function changePage(direction: 'previous' | 'next'): void {
    if (reviewQueue.changePage(direction)) feedback.reset();
  }

  function toggleList(): void {
    reviewQueue.toggleList();
    feedback.reset();
  }

  function toggleRepositoryScope(): void {
    void repositoryScope.toggle(() => {
      reviewQueue.resetPage();
      feedback.reset();
    });
  }

  function withSelectedPullRequest(
    action: (pullRequest: PullRequestSummary) => void
  ): void {
    const selected = reviewQueue.highlightedPullRequest;
    if (selected !== undefined) action(selected);
  }

  const { queueOwnsInput, failureViewerRef } = useQueueKeyboard({
    keyBindings,
    searchEditor,
    submission,
    details,
    helpOpen,
    closeHelp: () => setHelpOpen(false),
    activeFailure,
    dismissFailure: feedback.dismissFailure,
    actions: {
      showHelp: () => setHelpOpen(true),
      quit: onQuit,
      refresh: refreshFromStart,
      previousPullRequestPage: () => changePage('previous'),
      nextPullRequestPage: () => changePage('next'),
      togglePullRequestList: toggleList,
      toggleRepositoryScope,
      editReviewQueueSearch: searchEditor.open,
      openDetails: () => withSelectedPullRequest(details.open),
      openInBrowser: () => withSelectedPullRequest(feedback.openInBrowser),
      openDiff: () => withSelectedPullRequest(feedback.openDiff),
      runReviewCommand: () =>
        withSelectedPullRequest(feedback.runReviewCommand),
      composeReviewSubmission: () =>
        withSelectedPullRequest((target) => {
          feedback.clearNotice();
          submission.open(target);
        }),
      selectPrevious: () => reviewQueue.moveCursor('previous'),
      selectNext: () => reviewQueue.moveCursor('next'),
    },
  });

  return (
    <box width="100%" height="100%" flexDirection="column">
      <ReviewQueueScreen
        reviewQueue={reviewQueue}
        repositoryScope={repositoryScope}
        feedback={feedback}
        focused={queueOwnsInput}
        keyBindings={keyBindings}
        theme={theme}
      />
      <QueueOverlays
        details={details}
        submission={submission}
        searchEditor={searchEditor}
        helpOpen={helpOpen}
        list={reviewQueue.list}
        activeFailure={activeFailure}
        failureViewerRef={failureViewerRef}
        keyBindings={keyBindings}
        theme={theme}
      />
    </box>
  );
}
