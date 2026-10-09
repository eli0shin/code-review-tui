import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { EffectiveKeyBindings } from '../../configuration/index.ts';
import type { PullRequestSummary } from '../../domain/pull-request.ts';
import type { GitHub, PullRequestDetailSources } from '../../github/types.ts';
import { queueActionForKey, stopKey } from '../terminal/keys.ts';
import { collectDetailFailures } from './conversation.ts';

const detailsQueryKey = ['pullRequestDetails'] as const;

export function usePullRequestDetails(github: GitHub) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<PullRequestSummary>();
  const [errorsOpen, setErrorsOpen] = useState(false);
  const viewportRef = useRef<ScrollBoxRenderable>(null);
  const url = target?.url;
  const query = useQuery<PullRequestDetailSources>({
    queryKey: [...detailsQueryKey, url],
    enabled: url !== undefined,
    queryFn({ signal }) {
      if (url === undefined) {
        throw new Error('A pull request details target URL is required');
      }
      return github.loadPullRequestDetails(url, signal);
    },
  });
  const failures = collectDetailFailures(query.data);

  function open(pullRequest: PullRequestSummary): void {
    void queryClient.invalidateQueries({
      queryKey: [...detailsQueryKey, pullRequest.url],
      exact: true,
    });
    setTarget(pullRequest);
  }

  function closeErrors(): void {
    setErrorsOpen(false);
  }

  function handleKey(key: KeyEvent, keyBindings: EffectiveKeyBindings): void {
    if (target === undefined) return;
    stopKey(key);
    const action = queueActionForKey(key, keyBindings);
    const viewport = viewportRef.current;
    if (action === 'quit') {
      setTarget(undefined);
    } else if (action === 'refresh') {
      void queryClient.fetchQuery({
        queryKey: [...detailsQueryKey, target.url],
        queryFn: ({ signal }) =>
          github.loadPullRequestDetails(target.url, signal),
      });
    } else if (action === 'showErrors' && failures.length > 0) {
      setErrorsOpen(true);
    } else if (action === 'selectPrevious') {
      viewport?.scrollBy(-1, 'step');
    } else if (action === 'selectNext') {
      viewport?.scrollBy(1, 'step');
    } else if (
      viewport !== null &&
      (action === 'pagePrevious' || action === 'pageNext')
    ) {
      const direction = action === 'pagePrevious' ? -1 : 1;
      const halfViewport = Math.max(
        1,
        Math.floor(viewport.viewport.height / 2)
      );
      viewport.scrollBy(direction * halfViewport);
    } else if (action === 'scrollStart') {
      viewport?.scrollTo(0);
    } else if (action === 'scrollEnd') {
      viewport?.scrollTo(viewport.scrollHeight);
    }
  }

  return {
    target,
    query,
    failures,
    errorsOpen,
    viewportRef,
    open,
    closeErrors,
    handleKey,
  };
}
