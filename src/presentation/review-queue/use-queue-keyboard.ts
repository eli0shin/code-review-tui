import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useEffect, useRef } from 'react';
import type {
  EffectiveKeyBindings,
  QueueAction,
} from '../../configuration/index.ts';
import type { usePullRequestDetails } from '../details/use-pull-request-details.ts';
import type { useReviewSubmission } from '../submission/use-review-submission.ts';
import { matchesAction, queueActionForKey, stopKey } from '../terminal/keys.ts';
import type { QueueFailureOverlay } from './use-queue-feedback.ts';
import type { useQueueSearch } from './use-queue-search.ts';

export function useQueueKeyboard({
  keyBindings,
  searchEditor,
  submission,
  details,
  helpOpen,
  closeHelp,
  activeFailure,
  dismissFailure,
  actions,
}: {
  readonly keyBindings: EffectiveKeyBindings;
  readonly searchEditor: Pick<
    ReturnType<typeof useQueueSearch>,
    'draft' | 'handleKey'
  >;
  readonly submission: Pick<
    ReturnType<typeof useReviewSubmission>,
    'draft' | 'handleKey'
  >;
  readonly details: Pick<
    ReturnType<typeof usePullRequestDetails>,
    'target' | 'errorsOpen' | 'handleKey' | 'closeErrors'
  >;
  readonly helpOpen: boolean;
  readonly closeHelp: () => void;
  readonly activeFailure: QueueFailureOverlay | undefined;
  readonly dismissFailure: (key: string) => void;
  readonly actions: Partial<Record<QueueAction, () => void>>;
}) {
  const failureViewerRef = useRef<ScrollBoxRenderable>(null);
  useEffect(() => {
    failureViewerRef.current?.scrollTo(0);
  }, [activeFailure?.key, details.errorsOpen]);

  useKeyboard((key) => {
    if (searchEditor.draft !== undefined) {
      searchEditor.handleKey(key);
      return;
    }
    if (submission.draft !== undefined) {
      submission.handleKey(key);
      return;
    }
    if (activeFailure !== undefined) {
      stopKey(key);
      const action = queueActionForKey(key, keyBindings);
      if (
        action === 'refresh' ||
        action === 'previousPullRequestPage' ||
        action === 'togglePullRequestList' ||
        action === 'toggleRepositoryScope' ||
        action === 'editReviewQueueSearch'
      ) {
        actions[action]?.();
      } else if (key.name === 'escape') {
        dismissFailure(activeFailure.key);
      } else {
        scrollFailureViewer(key, failureViewerRef.current);
      }
      return;
    }
    if (details.errorsOpen) {
      stopKey(key);
      if (key.name === 'escape') details.closeErrors();
      else scrollFailureViewer(key, failureViewerRef.current);
      return;
    }
    if (details.target !== undefined) {
      details.handleKey(key, keyBindings);
      return;
    }
    if (helpOpen) {
      stopKey(key);
      if (
        key.name === 'escape' ||
        matchesAction(key, keyBindings, 'showHelp')
      ) {
        closeHelp();
      }
      return;
    }
    const action = queueActionForKey(key, keyBindings);
    if (action === undefined) return;
    stopKey(key);
    actions[action]?.();
  });

  const queueOwnsInput =
    searchEditor.draft === undefined &&
    submission.draft === undefined &&
    details.target === undefined &&
    !helpOpen &&
    activeFailure === undefined;
  return { failureViewerRef, queueOwnsInput };
}

function scrollFailureViewer(
  key: KeyEvent,
  viewer: ScrollBoxRenderable | null
): void {
  if (key.name === 'up') viewer?.scrollBy(-1, 'step');
  else if (key.name === 'down') viewer?.scrollBy(1, 'step');
  else if (key.name === 'pageup') viewer?.scrollBy(-1, 'viewport');
  else if (key.name === 'pagedown') viewer?.scrollBy(1, 'viewport');
  else if (key.name === 'home') viewer?.scrollTo(0);
  else if (key.name === 'end') viewer?.scrollTo(viewer.scrollHeight);
}
