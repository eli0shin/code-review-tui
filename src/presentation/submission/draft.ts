import type { RGBA, KeyEvent } from '@opentui/core';
import type {
  PullRequestSummary,
  ReviewDecision,
} from '../../domain/pull-request.ts';
import type { GitHubFailure } from '../../github/types.ts';
import type { SystemTheme } from '../terminal/theme.ts';
import { stopKey } from '../terminal/keys.ts';

export type SubmissionDraft = {
  readonly target: PullRequestSummary;
  readonly message: string;
  readonly action?: ReviewDecision;
  readonly validation?: string;
  readonly failure?: GitHubFailure;
  readonly inFlight: boolean;
};

export function handleSubmissionKey(
  key: KeyEvent,
  draft: SubmissionDraft,
  message: string,
  submitDraft: (
    draft: SubmissionDraft,
    action: ReviewDecision,
    message: string
  ) => Promise<void>,
  closeDraft: () => void
): void {
  if (key.name === 'escape') {
    stopKey(key);
    closeDraft();
    return;
  }

  const action = submissionAction(key);
  if (draft.inFlight) {
    if (action !== undefined) stopKey(key);
    return;
  }
  if (action === undefined) return;
  stopKey(key);
  void submitDraft(draft, action, message);
}

function submissionAction(key: KeyEvent): ReviewDecision | undefined {
  if (!key.ctrl) return undefined;
  if (key.name === 'a') return 'approve';
  if (key.name === 'c') return 'comment';
  if (key.name === 'r') return 'requestChanges';
  return undefined;
}

export function createDraft(target: PullRequestSummary): SubmissionDraft {
  return { target, message: '', inFlight: false };
}

export function submissionStatus(
  draft: SubmissionDraft,
  theme: SystemTheme | undefined
): {
  readonly message: string;
  readonly color: RGBA | undefined;
} {
  if (draft.validation !== undefined) {
    return { message: draft.validation, color: theme?.error };
  }
  if (draft.failure !== undefined) {
    return {
      message: submissionFailureMessage(draft),
      color: theme?.error,
    };
  }
  if (draft.inFlight && draft.action !== undefined) {
    return {
      message: `${submissionProgress(draft.action)} …`,
      color: theme?.info,
    };
  }
  return { message: ' ', color: undefined };
}

export function reviewActionLabel(action: ReviewDecision): string {
  switch (action) {
    case 'comment':
      return 'Comment';
    case 'approve':
      return 'Approval';
    case 'requestChanges':
      return 'Request changes';
  }
}

function submissionProgress(action: ReviewDecision): string {
  switch (action) {
    case 'comment':
      return 'Submitting comment';
    case 'approve':
      return 'Approving pull request';
    case 'requestChanges':
      return 'Requesting changes';
  }
}

function submissionFailureMessage(draft: SubmissionDraft): string {
  const failure = draft.failure;
  if (failure === undefined) return '';
  const target = `${draft.target.repository} #${draft.target.number}`;
  switch (failure.kind) {
    case 'startup':
      return `Review Submission for ${target} could not start gh: ${failure.diagnostic}`;
    case 'exit':
      return failure.stderr
        ? `Review Submission for ${target} exited unsuccessfully.\n${failure.stderr}`
        : `Review Submission for ${target} exited unsuccessfully with status ${failure.exitCode}. gh did not provide an error message.`;
    case 'interrupted': {
      const ending = failure.signal
        ? `signal ${failure.signal}`
        : failure.diagnostic || failure.reason;
      const message = `Review Submission for ${target} was interrupted (${ending}). Submission success is unknown.`;
      return failure.stderr ? `${message}\n${failure.stderr}` : message;
    }
    case 'malformedData':
    case 'incompatibleData':
      return failure.stderr
        ? `Review Submission for ${target} failed: ${failure.diagnostic}\n${failure.stderr}`
        : `Review Submission for ${target} failed: ${failure.diagnostic}`;
  }
}
