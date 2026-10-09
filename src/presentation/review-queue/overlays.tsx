import type { ScrollBoxRenderable } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/react';
import type { EffectiveKeyBindings } from '../../configuration/index.ts';
import type { PullRequestList } from '../../github/types.ts';
import { PullRequestDetailsModal } from '../details/modal.tsx';
import type { usePullRequestDetails } from '../details/use-pull-request-details.ts';
import { SubmissionModal } from '../submission/modal.tsx';
import type { useReviewSubmission } from '../submission/use-review-submission.ts';
import { FailureOverlay, failureMessage } from '../terminal/diagnostics.tsx';
import type { SystemTheme } from '../terminal/theme.ts';
import { HelpOverlay } from './help.tsx';
import { SearchModal } from './search-modal.tsx';
import type { QueueFailureOverlay } from './use-queue-feedback.ts';
import type { useQueueSearch } from './use-queue-search.ts';

export function QueueOverlays({
  details,
  submission,
  searchEditor,
  helpOpen,
  list,
  activeFailure,
  failureViewerRef,
  keyBindings,
  theme,
}: {
  readonly details: ReturnType<typeof usePullRequestDetails>;
  readonly submission: ReturnType<typeof useReviewSubmission>;
  readonly searchEditor: ReturnType<typeof useQueueSearch>;
  readonly helpOpen: boolean;
  readonly list: PullRequestList;
  readonly activeFailure: QueueFailureOverlay | undefined;
  readonly failureViewerRef: React.Ref<ScrollBoxRenderable>;
  readonly keyBindings: EffectiveKeyBindings;
  readonly theme: SystemTheme;
}) {
  const terminal = useTerminalDimensions();
  return (
    <>
      {details.target !== undefined ? (
        <PullRequestDetailsModal
          ref={details.viewportRef}
          target={details.target}
          sources={details.query.data}
          loading={details.query.isPending || details.query.isFetching}
          keyBindings={keyBindings}
          theme={theme}
        />
      ) : null}
      {helpOpen ? (
        <HelpOverlay list={list} keyBindings={keyBindings} theme={theme} />
      ) : null}
      {activeFailure !== undefined ? (
        <FailureOverlay
          ref={failureViewerRef}
          title={activeFailure.title}
          message={activeFailure.message}
          theme={theme}
        />
      ) : null}
      {details.errorsOpen && details.target !== undefined ? (
        <FailureOverlay
          ref={failureViewerRef}
          title={`Pull request detail errors · ${details.target.repository} #${details.target.number}`}
          message={details.failures
            .map(({ label, failure }) => `${label}: ${failureMessage(failure)}`)
            .join('\n\n')}
          theme={theme}
        />
      ) : null}
      {searchEditor.draft !== undefined ? (
        <SearchModal
          text={searchEditor.draft}
          validation={searchEditor.validation}
          editorRef={searchEditor.editorRef}
          onInput={searchEditor.updateText}
          onClose={searchEditor.close}
          terminal={terminal}
          theme={theme}
        />
      ) : null}
      {submission.draft !== undefined ? (
        <SubmissionModal
          draft={submission.draft}
          editorRef={submission.editorRef}
          onInput={submission.updateMessage}
          onClose={submission.close}
          terminal={terminal}
          theme={theme}
        />
      ) : null}
    </>
  );
}
