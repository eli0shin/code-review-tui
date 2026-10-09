import type { ReactNode } from 'react';
import type { EffectiveKeyBindings } from '../../configuration/index.ts';
import { StatusView, failureMessage } from '../terminal/diagnostics.tsx';
import { formatBindings } from '../terminal/keys.ts';
import type { SystemTheme } from '../terminal/theme.ts';
import { ReviewQueueContent } from './content.tsx';
import type { useQueueFeedback } from './use-queue-feedback.ts';
import type { useRepositoryScope } from './use-repository-scope.ts';
import type { useReviewQueue } from './use-review-queue.ts';

export function ReviewQueueScreen({
  reviewQueue,
  repositoryScope,
  feedback,
  focused,
  keyBindings,
  theme,
}: {
  readonly reviewQueue: ReturnType<typeof useReviewQueue>;
  readonly repositoryScope: ReturnType<typeof useRepositoryScope>;
  readonly feedback: Pick<
    ReturnType<typeof useQueueFeedback>,
    'notice' | 'herdrActionFailure'
  >;
  readonly focused: boolean;
  readonly keyBindings: EffectiveKeyBindings;
  readonly theme: SystemTheme;
}) {
  const { query, queue, list, listName, cursorPosition, pageNumber } =
    reviewQueue;
  let content: ReactNode;
  if (query.status === 'pending') {
    content = (
      <StatusView
        title={
          list === 'reviewQueue'
            ? 'Fetching PRs to review…'
            : 'Fetching my PRs…'
        }
        theme={theme}
      />
    );
  } else if (query.status === 'error' && queue.length === 0) {
    content = (
      <StatusView
        title={`${listName} unavailable`}
        detail={`${failureMessage(query.error)} · ${formatBindings(keyBindings.refresh)} retry`}
        theme={theme}
        error
      />
    );
  } else if (queue.length === 0) {
    content = (
      <StatusView
        title={
          list === 'reviewQueue'
            ? 'No reviews waiting'
            : 'No open PRs authored by me'
        }
        detail={`Press ${formatBindings(keyBindings.refresh)} to refresh · ${formatBindings(keyBindings.togglePullRequestList)} switch list${list === 'reviewQueue' ? ` · ${formatBindings(keyBindings.editReviewQueueSearch)} edit query` : ''}`}
        theme={theme}
      />
    );
  } else {
    const pageStatusText = `Page ${pageNumber} · ${formatBindings(keyBindings.previousPullRequestPage)} previous${query.data?.nextCursor === null ? ' · last page' : ` · ${formatBindings(keyBindings.nextPullRequestPage)} next`}`;
    content = (
      <ReviewQueueContent
        key={list}
        list={list}
        queue={queue}
        cursorPosition={cursorPosition}
        pageStatusText={pageStatusText}
        scopeLabel={repositoryScope.label}
        scopeDiagnostic={repositoryScope.diagnostic}
        resolvingRepository={repositoryScope.resolving}
        refreshing={query.isFetching}
        refreshFailure={query.error ?? null}
        notice={feedback.notice}
        herdrActionFailure={feedback.herdrActionFailure}
        keyBindings={keyBindings}
        theme={theme}
      />
    );
  }
  return (
    <box focusable focused={focused} flexGrow={1} flexDirection="column">
      {queue.length === 0 && repositoryScope.diagnostic !== undefined ? (
        <text flexShrink={0} fg={theme.error} wrapMode="char">
          {repositoryScope.diagnostic}
        </text>
      ) : null}
      {content}
    </box>
  );
}
