import { useState } from 'react';
import type { EffectiveKeyBindings } from '../../configuration/index.ts';
import type { PullRequestSummary } from '../../domain/pull-request.ts';
import type { GitHub } from '../../github/types.ts';
import type { Herdr, HerdrFailure, HerdrResult } from '../../tools/types.ts';
import {
  failureMessage,
  githubFailureKey,
  herdrFailureMessage,
} from '../terminal/diagnostics.tsx';
import { formatBindings } from '../terminal/keys.ts';
import {
  renderedRows,
  requiresFailureOverlay,
} from '../terminal/text-layout.ts';
import type { useReviewQueue } from './use-review-queue.ts';

export type QueueNotice = {
  readonly message: string;
  readonly tone?: 'error' | 'success';
};

export type HerdrActionFailure = {
  readonly action: 'diff' | 'Review Command';
  readonly failure: HerdrFailure;
};

export type QueueFailureOverlay = {
  readonly key: string;
  readonly title: string;
  readonly message: string;
};

export function useQueueFeedback({
  github,
  herdr,
  reviewQueue,
  scopeDiagnostic,
  terminal,
  keyBindings,
}: {
  readonly github: GitHub;
  readonly herdr: Herdr;
  readonly reviewQueue: Pick<
    ReturnType<typeof useReviewQueue>,
    'query' | 'queue' | 'listName'
  >;
  readonly scopeDiagnostic: string | undefined;
  readonly terminal: { readonly width: number; readonly height: number };
  readonly keyBindings: EffectiveKeyBindings;
}) {
  const [notice, setNotice] = useState<QueueNotice>();
  const [herdrActionFailure, setHerdrActionFailure] =
    useState<HerdrActionFailure>();
  const [dismissedFailureKey, setDismissedFailureKey] = useState<string>();
  const queueFailure = reviewQueue.query.error ?? null;
  const empty = reviewQueue.queue.length === 0;
  const statusWidth = terminal.width - 5;
  const scopeDiagnosticRows =
    scopeDiagnostic === undefined
      ? 0
      : renderedRows(scopeDiagnostic, terminal.width);
  const occupiedStatusRows =
    (notice === undefined ? 0 : renderedRows(notice.message, statusWidth)) +
    (herdrActionFailure === undefined
      ? 0
      : renderedRows(
          `Could not open ${herdrActionFailure.action}: ${herdrFailureMessage(herdrActionFailure.failure)}${herdrActionFailure.failure.stderr ? `\n${herdrActionFailure.failure.stderr}` : ''}`,
          statusWidth
        ));
  let failureOverlay: QueueFailureOverlay | undefined;
  if (
    queueFailure !== null &&
    requiresFailureOverlay(
      empty
        ? `${failureMessage(queueFailure)} · ${formatBindings(keyBindings.refresh)} retry`
        : `${reviewQueue.listName} not refreshed: ${failureMessage(queueFailure)}`,
      empty ? terminal.width : statusWidth,
      empty ? terminal.height - 2 - scopeDiagnosticRows : 3 - occupiedStatusRows
    ) &&
    githubFailureKey(queueFailure) !== dismissedFailureKey
  ) {
    failureOverlay = {
      key: githubFailureKey(queueFailure),
      title: `${reviewQueue.listName} ${empty ? 'unavailable' : 'not refreshed'}`,
      message: failureMessage(queueFailure),
    };
  }

  function clearNotice(): void {
    setNotice(undefined);
  }

  function reset(): void {
    setNotice(undefined);
    setDismissedFailureKey(undefined);
    setHerdrActionFailure(undefined);
  }

  function dismissFailure(key: string): void {
    setDismissedFailureKey(key);
  }

  async function openInBrowser(pullRequest: PullRequestSummary): Promise<void> {
    setNotice(undefined);
    const result = await github.openPullRequestInBrowser(
      pullRequest.url,
      new AbortController().signal
    );
    if (!result.ok) {
      setNotice({
        message: `Could not open ${pullRequest.repository} #${pullRequest.number} in the browser: ${failureMessage(result.failure)}`,
        tone: 'error',
      });
    }
  }

  async function openHerdrTab(
    action: HerdrActionFailure['action'],
    open: () => Promise<HerdrResult>
  ): Promise<void> {
    setHerdrActionFailure(undefined);
    const result = await open();
    if (!result.ok) setHerdrActionFailure({ action, failure: result.failure });
  }

  function openDiff(pullRequest: PullRequestSummary): void {
    void openHerdrTab('diff', () => herdr.openDiff(pullRequest));
  }

  function runReviewCommand(pullRequest: PullRequestSummary): void {
    void openHerdrTab('Review Command', () =>
      herdr.openReviewCommand(pullRequest)
    );
  }

  return {
    notice,
    herdrActionFailure,
    failureOverlay,
    clearNotice,
    reset,
    dismissFailure,
    openInBrowser,
    openDiff,
    runReviewCommand,
  };
}
