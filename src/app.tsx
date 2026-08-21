import { createCliRenderer } from '@opentui/core';
import type { TextareaRenderable } from '@opentui/core';
import { createRoot, useKeyboard } from '@opentui/react';
import {
  environmentManager,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type {
  PullRequestDetails,
  PullRequestSummary,
  ReviewDecision,
  ReviewQueue,
} from './domain/pull-request.ts';
import type { GitHub, GitHubFailure } from './github/types.ts';

environmentManager.setIsServer(() => false);

const refreshIntervalMs = 60_000;
const detailsQueryKey = ['pullRequestDetails'] as const;
const emptyReviewQueue: ReviewQueue = [];
const decisions = ['comment', 'approve', 'requestChanges'] as const;

type SubmissionFocus = 'editor' | 'decision';
type ConfirmationChoice = 'keepEditing' | 'discard';

type SubmissionDraft = {
  readonly target: PullRequestSummary;
  readonly message: string;
  readonly decision: ReviewDecision;
  readonly focus: SubmissionFocus;
  readonly confirmation: boolean;
  readonly confirmationChoice: ConfirmationChoice;
  readonly validation?: string;
  readonly failure?: GitHubFailure;
  readonly inFlight: boolean;
};

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
  const [draft, setDraft] = useState<SubmissionDraft>();
  const [notice, setNotice] = useState<string>();
  const editorRef = useRef<TextareaRenderable>(null);
  const submissionActiveRef = useRef(false);
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
  const lastCursorPosition = Math.max(queue.length - 1, 0);
  const cursorPosition = Math.min(cursor, lastCursorPosition);
  if (cursor !== cursorPosition) setCursor(cursorPosition);
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

  const submitDraft = async (submission: SubmissionDraft): Promise<void> => {
    if (submission.decision !== 'approve' && !/\S/.test(submission.message)) {
      setDraft({
        ...submission,
        focus: 'editor',
        validation: 'A message is required for this decision.',
      });
      return;
    }
    if (submissionActiveRef.current) return;
    submissionActiveRef.current = true;

    setDraft({
      ...submission,
      failure: undefined,
      validation: undefined,
      inFlight: true,
    });
    const result = await github.submitReview(
      {
        url: submission.target.url,
        message: submission.message,
        decision: submission.decision,
      },
      new AbortController().signal
    );
    submissionActiveRef.current = false;
    if (!result.ok) {
      setDraft({ ...submission, failure: result.failure, inFlight: false });
      return;
    }

    const successNotice = submissionSuccessNotice(submission);
    setDraft(undefined);
    setNotice(`${successNotice} Refreshing Review Queue…`);
    const refresh = await queueQuery.refetch();
    if (refresh.isError) {
      setNotice(`${successNotice} Review Queue could not be refreshed.`);
    }
  };

  useKeyboard((key) => {
    if (draft !== undefined) {
      if (draft.inFlight) {
        key.preventDefault();
        key.stopPropagation();
        return;
      }

      if (draft.confirmation) {
        key.preventDefault();
        key.stopPropagation();
        if (key.name === 'left') {
          setDraft({ ...draft, confirmationChoice: 'keepEditing' });
        } else if (key.name === 'right') {
          setDraft({ ...draft, confirmationChoice: 'discard' });
        } else if (key.name === 'escape') {
          setDraft({ ...draft, confirmation: false });
        } else if (key.name === 'return' || key.name === 'enter') {
          if (draft.confirmationChoice === 'discard') setDraft(undefined);
          else setDraft({ ...draft, confirmation: false });
        }
        return;
      }

      if (key.ctrl && key.name === 's') {
        key.preventDefault();
        key.stopPropagation();
        void submitDraft(draft);
        return;
      }
      if (key.name === 'escape') {
        key.preventDefault();
        key.stopPropagation();
        const changed = draft.message !== '' || draft.decision !== 'comment';
        if (changed) setDraft({ ...draft, confirmation: true });
        else setDraft(undefined);
        return;
      }
      if (key.name === 'tab') {
        key.preventDefault();
        key.stopPropagation();
        setDraft({
          ...draft,
          focus: key.shift ? 'editor' : 'decision',
        });
        return;
      }
      if (draft.focus === 'decision') {
        key.preventDefault();
        key.stopPropagation();
        const current = decisions.indexOf(draft.decision);
        const next =
          key.name === 'left'
            ? Math.max(0, current - 1)
            : key.name === 'right'
              ? Math.min(decisions.length - 1, current + 1)
              : key.name === 'home'
                ? 0
                : key.name === 'end'
                  ? decisions.length - 1
                  : current;
        if (next !== current) setDraft({ ...draft, decision: decisions[next] });
      }
      return;
    }

    if (key.name === 's' && highlightedPullRequest !== undefined) {
      setNotice(undefined);
      setDraft(createDraft(highlightedPullRequest));
      return;
    }
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
      {notice !== undefined ? <text>{notice}</text> : null}
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
      {draft !== undefined ? (
        <box flexDirection="column">
          <text>
            Review {draft.target.repository} #{draft.target.number}
          </text>
          <text>{draft.target.title}</text>
          {draft.confirmation ? (
            <box flexDirection="column">
              <text>Discard this Review Submission?</text>
              <text>
                {draft.confirmationChoice === 'keepEditing' ? '[x]' : '[ ]'}{' '}
                Keep editing{'   '}
                {draft.confirmationChoice === 'discard' ? '[x]' : '[ ]'} Discard
              </text>
              <text>Left/Right choose Enter confirm Esc keep editing</text>
            </box>
          ) : (
            <>
              <textarea
                ref={editorRef}
                initialValue={draft.message}
                focused={draft.focus === 'editor' && !draft.inFlight}
                height={5}
                onContentChange={() => {
                  const message = editorRef.current?.plainText ?? '';
                  setDraft((current) =>
                    current === undefined
                      ? current
                      : { ...current, message, validation: undefined }
                  );
                }}
                onKeyDown={(key) => {
                  if (key.name !== 'escape') return;
                  key.preventDefault();
                  key.stopPropagation();
                  const changed =
                    draft.message !== '' || draft.decision !== 'comment';
                  if (changed) setDraft({ ...draft, confirmation: true });
                  else setDraft(undefined);
                }}
              />
              <text>
                {draft.focus === 'decision' ? '› ' : '  '}
                {decisionMark(draft, 'comment')} Comment{'   '}
                {decisionMark(draft, 'approve')} Approve{'   '}
                {decisionMark(draft, 'requestChanges')} Request changes
              </text>
              {draft.validation !== undefined ? (
                <text>{draft.validation}</text>
              ) : null}
              {draft.failure !== undefined ? (
                <text>{submissionFailureMessage(draft)}</text>
              ) : null}
              {draft.inFlight ? (
                <text>{submissionProgress(draft.decision)} …</text>
              ) : null}
              <text>Tab decision Ctrl+S submit Esc cancel</text>
            </>
          )}
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

function createDraft(target: PullRequestSummary): SubmissionDraft {
  return {
    target,
    message: '',
    decision: 'comment',
    focus: 'editor',
    confirmation: false,
    confirmationChoice: 'keepEditing',
    inFlight: false,
  };
}

function decisionMark(
  draft: SubmissionDraft,
  decision: ReviewDecision
): '[x]' | '[ ]' {
  return draft.decision === decision ? '[x]' : '[ ]';
}

function submissionProgress(decision: ReviewDecision): string {
  switch (decision) {
    case 'comment':
      return 'Submitting comment';
    case 'approve':
      return 'Submitting approval';
    case 'requestChanges':
      return 'Submitting request for changes';
  }
}

function submissionSuccessNotice(draft: SubmissionDraft): string {
  const target = `${draft.target.repository} #${draft.target.number}.`;
  switch (draft.decision) {
    case 'comment':
      return `Commented on ${target}`;
    case 'approve':
      return `Approved ${target}`;
    case 'requestChanges':
      return `Requested changes on ${target}`;
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
