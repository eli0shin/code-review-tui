import {
  createCliRenderer,
  normalizeTerminalPalette,
  RGBA,
  TextAttributes,
  type KeyEvent,
  type TerminalColors,
  type TextareaRenderable,
} from '@opentui/core';
import { createRoot, useKeyboard, useRenderer } from '@opentui/react';
import {
  environmentManager,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  normalizeKeyDescriptor,
  queueActions,
  type EffectiveKeyBindings,
  type QueueAction,
} from './configuration/index.ts';
import type {
  PullRequestDetails,
  PullRequestSummary,
  ReviewDecision,
  ReviewQueue,
} from './domain/pull-request.ts';
import type { GitHub, GitHubFailure } from './github/types.ts';
import type { Herdr, HerdrFailure, HerdrResult } from './tools/types.ts';

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
  readonly herdr: Herdr;
  readonly keyBindings: EffectiveKeyBindings;
  readonly onQuit: () => void;
};

type HerdrActionFailure = {
  readonly action: 'Lumen' | 'Review Command';
  readonly failure: HerdrFailure;
};

type SystemTheme = {
  readonly success: RGBA;
  readonly error: RGBA;
  readonly info: RGBA;
  readonly secondary: RGBA;
  readonly warning: RGBA;
  readonly textMuted: RGBA;
  readonly foreground: RGBA;
  readonly background: RGBA;
  readonly subtleSurface: RGBA;
};

export function ReviewQueuePage({
  github,
  herdr,
  keyBindings,
  onQuit,
}: ReviewQueuePageProps) {
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
      <ReviewQueue
        github={github}
        herdr={herdr}
        keyBindings={keyBindings}
        onQuit={onQuit}
      />
    </QueryClientProvider>
  );
}

function ReviewQueue({
  github,
  herdr,
  keyBindings,
  onQuit,
}: ReviewQueuePageProps) {
  const theme = useSystemTheme();
  const [cursor, setCursor] = useState(0);
  const [draft, setDraft] = useState<SubmissionDraft>();
  const [showHelp, setShowHelp] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [herdrActionFailure, setHerdrActionFailure] =
    useState<HerdrActionFailure>();
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

  const openHerdrTab = async (
    action: HerdrActionFailure['action'],
    open: () => Promise<HerdrResult>
  ): Promise<void> => {
    setHerdrActionFailure(undefined);
    const result = await open();
    if (!result.ok) setHerdrActionFailure({ action, failure: result.failure });
  };

  useKeyboard((key) => {
    if (draft !== undefined) {
      handleSubmissionKey(key, draft, setDraft, submitDraft);
      return;
    }

    if (showHelp) {
      key.preventDefault();
      key.stopPropagation();
      if (
        key.name === 'escape' ||
        matchesAction(key, keyBindings, 'showHelp')
      ) {
        setShowHelp(false);
      }
      return;
    }

    const action = queueActionForKey(key, keyBindings);
    if (action === undefined) return;
    key.preventDefault();
    key.stopPropagation();

    if (action === 'showHelp') {
      setShowHelp(true);
      return;
    }
    if (action === 'quit') {
      onQuit();
      return;
    }
    if (action === 'refresh') {
      void queueQuery.refetch();
      return;
    }
    if (highlightedPullRequest === undefined) return;

    if (action === 'openDiff') {
      void openHerdrTab('Lumen', () => herdr.openLumen(highlightedPullRequest));
      return;
    }
    if (action === 'runReviewCommand') {
      void openHerdrTab('Review Command', () =>
        herdr.openReviewCommand(highlightedPullRequest)
      );
      return;
    }
    if (action === 'composeReviewSubmission') {
      setNotice(undefined);
      setDraft(createDraft(highlightedPullRequest));
      return;
    }

    const offset = action === 'selectNext' ? 1 : -1;
    const nextPosition = cursorPosition + offset;
    if (nextPosition >= 0 && nextPosition < queue.length) {
      setCursor(nextPosition);
    }
  });

  const initialFailure = queueQuery.status === 'error' && queue.length === 0;
  const queueOwnsInput = draft === undefined && !showHelp;

  return (
    <box width="100%" height="100%" flexDirection="column">
      <box
        focusable
        focused={queueOwnsInput}
        flexGrow={1}
        flexDirection="column"
      >
        {queueQuery.status === 'pending' ? (
          <StatusView
            title="Loading review requests…"
            detail="Running the configured GitHub search"
            theme={theme}
          />
        ) : initialFailure ? (
          <StatusView
            title="Review Queue unavailable"
            detail={`${failureMessage(queueQuery.error)} · ${formatBindings(
              keyBindings.refresh
            )} retry`}
            theme={theme}
            error
          />
        ) : queue.length === 0 ? (
          <StatusView
            title="No reviews waiting"
            detail={`Press ${formatBindings(
              keyBindings.refresh
            )} to refresh the configured search`}
            theme={theme}
          />
        ) : (
          <ReviewQueueContent
            queue={queue}
            cursorPosition={cursorPosition}
            details={detailsQuery.data}
            detailsStatus={detailsQuery.status}
            detailsFailure={detailsQuery.error}
            refreshing={queueQuery.isFetching}
            refreshFailure={queueQuery.error}
            notice={notice}
            herdrActionFailure={herdrActionFailure}
            keyBindings={keyBindings}
            theme={theme}
          />
        )}
      </box>
      {showHelp ? (
        <HelpOverlay keyBindings={keyBindings} theme={theme} />
      ) : null}
      {draft !== undefined ? (
        <SubmissionModal
          draft={draft}
          editorRef={editorRef}
          setDraft={setDraft}
          theme={theme}
        />
      ) : null}
    </box>
  );
}

function ReviewQueueContent({
  queue,
  cursorPosition,
  details,
  detailsStatus,
  detailsFailure,
  refreshing,
  refreshFailure,
  notice,
  herdrActionFailure,
  keyBindings,
  theme,
}: {
  readonly queue: ReviewQueue;
  readonly cursorPosition: number;
  readonly details: PullRequestDetails | undefined;
  readonly detailsStatus: 'pending' | 'error' | 'success';
  readonly detailsFailure: GitHubFailure | null;
  readonly refreshing: boolean;
  readonly refreshFailure: GitHubFailure | null;
  readonly notice: string | undefined;
  readonly herdrActionFailure: HerdrActionFailure | undefined;
  readonly keyBindings: EffectiveKeyBindings;
  readonly theme: SystemTheme | undefined;
}) {
  return (
    <box flexGrow={1} flexDirection="column" paddingLeft={2} paddingRight={2}>
      <box height={3} alignItems="center" justifyContent="space-between">
        <text>
          <strong>Review requests</strong>{' '}
          <span attributes={TextAttributes.DIM}>{queue.length} open</span>
        </text>
        <text attributes={TextAttributes.DIM}>
          {refreshing ? 'refreshing…' : 'updated'}{' '}
          {formatBindings(keyBindings.refresh)} refresh
        </text>
      </box>
      {notice !== undefined ? <text fg={theme?.success}>{notice}</text> : null}
      {refreshFailure !== null ? (
        <text fg={theme?.error}>
          Review Queue not refreshed: {failureMessage(refreshFailure)}
        </text>
      ) : null}
      {herdrActionFailure !== undefined ? (
        <text fg={theme?.error}>
          Could not open {herdrActionFailure.action}:{' '}
          {herdrFailureMessage(herdrActionFailure.failure)}
        </text>
      ) : null}
      <box flexDirection="column">
        {queue.map((pullRequest, index) => (
          <ReviewQueueRow
            key={pullRequest.url}
            pullRequest={pullRequest}
            underCursor={index === cursorPosition}
            details={
              index === cursorPosition && details?.url === pullRequest.url
                ? details
                : undefined
            }
            theme={theme}
          />
        ))}
      </box>
      <DetailsPane
        status={detailsStatus}
        details={details}
        failure={detailsFailure}
        theme={theme}
      />
      <box flexGrow={1} />
      <text attributes={TextAttributes.DIM}> {footerText(keyBindings)}</text>
    </box>
  );
}

function ReviewQueueRow({
  pullRequest,
  underCursor,
  details,
  theme,
}: {
  readonly pullRequest: PullRequestSummary;
  readonly underCursor: boolean;
  readonly details: PullRequestDetails | undefined;
  readonly theme: SystemTheme | undefined;
}) {
  return (
    <box
      width="100%"
      height={4}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="column"
      justifyContent="center"
      backgroundColor={underCursor ? theme?.subtleSurface : undefined}
    >
      <text>
        <span fg={theme?.success}>● </span>
        <strong>{pullRequest.title}</strong>
      </text>
      <text>
        {'  '}
        <span fg={theme?.info}>{pullRequest.repository}</span>
        <span fg={theme?.textMuted}> #{pullRequest.number} opened by </span>
        <span fg={theme?.secondary}>{pullRequest.author}</span>
        <span fg={theme?.textMuted}>
          {' '}
          · updated {relativeAge(pullRequest.updatedAt)}
          {details === undefined
            ? ''
            : ` · ${fileSummary(details.changedFiles)} `}
        </span>
        {details === undefined ? null : (
          <>
            <span fg={theme?.success}>+{details.additions}</span>{' '}
            <span fg={theme?.error}>-{details.deletions}</span>
            {details.labels.length === 0 ? null : (
              <span fg={theme?.warning}> · {details.labels.join('  ')}</span>
            )}
          </>
        )}
      </text>
    </box>
  );
}

function DetailsPane({
  status,
  details,
  failure,
  theme,
}: {
  readonly status: 'pending' | 'error' | 'success';
  readonly details: PullRequestDetails | undefined;
  readonly failure: GitHubFailure | null;
  readonly theme: SystemTheme | undefined;
}) {
  return (
    <box marginTop={1} paddingLeft={1} flexDirection="column">
      <text>
        <strong>Pull request details</strong>
      </text>
      {status === 'pending' ? (
        <text fg={theme?.textMuted}>Loading pull request details…</text>
      ) : null}
      {status === 'error' && failure !== null ? (
        <text fg={theme?.error}>
          Could not load pull request details: {failureMessage(failure)}
        </text>
      ) : null}
      {details !== undefined ? (
        <>
          <text>
            <strong>{details.title}</strong>
          </text>
          <text fg={theme?.textMuted}>
            {details.baseRefName} ← {details.headRefName} ·{' '}
            {fileSummary(details.changedFiles)}
            {'  '}
            <span fg={theme?.success}>+{details.additions}</span>{' '}
            <span fg={theme?.error}>-{details.deletions}</span>
          </text>
          {details.labels.length === 0 ? null : (
            <text fg={theme?.warning}>{details.labels.join('  ')}</text>
          )}
          <text>{details.body || 'No description provided.'}</text>
        </>
      ) : null}
    </box>
  );
}

function StatusView({
  title,
  detail,
  theme,
  error = false,
}: {
  readonly title: string;
  readonly detail: string;
  readonly theme: SystemTheme | undefined;
  readonly error?: boolean;
}) {
  return (
    <box
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      gap={1}
    >
      <text fg={error ? theme?.error : undefined}>
        <strong>{title}</strong>
      </text>
      <text fg={theme?.textMuted}>{detail}</text>
    </box>
  );
}

function HelpOverlay({
  keyBindings,
  theme,
}: {
  readonly keyBindings: EffectiveKeyBindings;
  readonly theme: SystemTheme | undefined;
}) {
  const line = (action: QueueAction, label: string) =>
    `${formatBindings(keyBindings[action])}  ${label}`;
  return (
    <box
      position="absolute"
      left="25%"
      top="15%"
      width="50%"
      height={14}
      zIndex={10}
      border
      borderColor={theme?.info}
      backgroundColor={theme?.background}
      padding={1}
      flexDirection="column"
    >
      <text>
        <strong>Review Queue keys</strong>
      </text>
      <text>{line('selectPrevious', 'previous')}</text>
      <text>{line('selectNext', 'next')}</text>
      <text>{line('openDiff', 'open diff')}</text>
      <text>{line('runReviewCommand', 'run Review Command')}</text>
      <text>
        {line('composeReviewSubmission', 'compose Review Submission')}
      </text>
      <text>{line('refresh', 'refresh')}</text>
      <text>{line('quit', 'quit')}</text>
      <text fg={theme?.textMuted}>Esc close</text>
    </box>
  );
}

function SubmissionModal({
  draft,
  editorRef,
  setDraft,
  theme,
}: {
  readonly draft: SubmissionDraft;
  readonly editorRef: React.RefObject<TextareaRenderable | null>;
  readonly setDraft: React.Dispatch<
    React.SetStateAction<SubmissionDraft | undefined>
  >;
  readonly theme: SystemTheme | undefined;
}) {
  return (
    <box
      position="absolute"
      left="15%"
      top="10%"
      width="70%"
      height={18}
      zIndex={20}
      border
      borderColor={theme?.info}
      backgroundColor={theme?.background}
      padding={1}
      flexDirection="column"
    >
      <text>
        <strong>{`Review ${draft.target.repository} #${draft.target.number}`}</strong>
      </text>
      <text fg={theme?.textMuted}>{draft.target.title}</text>
      {draft.confirmation ? (
        <box flexGrow={1} flexDirection="column" justifyContent="center">
          <text>
            <strong>Discard this Review Submission?</strong>
          </text>
          <text>
            {draft.confirmationChoice === 'keepEditing' ? '[x]' : '[ ]'} Keep
            editing{'   '}
            {draft.confirmationChoice === 'discard' ? '[x]' : '[ ]'} Discard
          </text>
          <text fg={theme?.textMuted}>
            Left/Right choose Enter confirm Esc keep editing
          </text>
        </box>
      ) : (
        <>
          <textarea
            ref={editorRef}
            initialValue={draft.message}
            focused={draft.focus === 'editor' && !draft.inFlight}
            flexGrow={1}
            minHeight={5}
            backgroundColor={theme?.subtleSurface}
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
              cancelDraft(draft, setDraft);
            }}
          />
          <text>
            {draft.focus === 'decision' ? '› ' : '  '}
            {decisionMark(draft, 'comment')} Comment{'   '}
            {decisionMark(draft, 'approve')} Approve{'   '}
            {decisionMark(draft, 'requestChanges')} Request changes
          </text>
          {draft.validation !== undefined ? (
            <text fg={theme?.error}>{draft.validation}</text>
          ) : null}
          {draft.failure !== undefined ? (
            <text fg={theme?.error}>{submissionFailureMessage(draft)}</text>
          ) : null}
          {draft.inFlight ? (
            <text fg={theme?.info}>{submissionProgress(draft.decision)} …</text>
          ) : null}
          <text fg={theme?.textMuted}>
            Tab decision Ctrl+S submit Esc cancel
          </text>
        </>
      )}
    </box>
  );
}

function handleSubmissionKey(
  key: KeyEvent,
  draft: SubmissionDraft,
  setDraft: React.Dispatch<React.SetStateAction<SubmissionDraft | undefined>>,
  submitDraft: (draft: SubmissionDraft) => Promise<void>
): void {
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
    cancelDraft(draft, setDraft);
    return;
  }
  if (key.name === 'tab') {
    key.preventDefault();
    key.stopPropagation();
    setDraft({ ...draft, focus: key.shift ? 'editor' : 'decision' });
    return;
  }
  if (draft.focus !== 'decision') return;

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

function cancelDraft(
  draft: SubmissionDraft,
  setDraft: React.Dispatch<React.SetStateAction<SubmissionDraft | undefined>>
): void {
  const changed = draft.message !== '' || draft.decision !== 'comment';
  if (changed) {
    setDraft({
      ...draft,
      confirmation: true,
      confirmationChoice: 'keepEditing',
    });
  } else setDraft(undefined);
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

function herdrFailureMessage(failure: HerdrFailure): string {
  const message =
    failure.exitCode === undefined
      ? failure.message
      : `${failure.message} (exit code ${failure.exitCode})`;
  return failure.stderr ? `${message}\n${failure.stderr}` : message;
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

function queueActionForKey(
  key: KeyEvent,
  keyBindings: EffectiveKeyBindings
): QueueAction | undefined {
  return queueActions.find((action) => matchesAction(key, keyBindings, action));
}

function matchesAction(
  key: KeyEvent,
  keyBindings: EffectiveKeyBindings,
  action: QueueAction
): boolean {
  return keyBindings[action].includes(keyDescriptor(key));
}

function keyDescriptor(key: KeyEvent): string {
  const eventName = key.name === 'return' ? 'enter' : key.name;
  const name = /^[A-Z]$/.test(eventName) ? eventName.toLowerCase() : eventName;
  const modifiers = [
    key.ctrl ? 'ctrl' : undefined,
    key.meta || key.option ? 'alt' : undefined,
    key.shift &&
    /^(?:[a-z0-9]|up|down|left|right|enter|escape|tab|backspace|delete|home|end|pageup|pagedown|space)$/i.test(
      name
    )
      ? 'shift'
      : undefined,
  ].filter((modifier): modifier is string => modifier !== undefined);
  const descriptor =
    modifiers.length === 0 ? name : `${modifiers.join('+')}+${name}`;
  return normalizeKeyDescriptor(descriptor);
}

function formatBindings(bindings: readonly string[]): string {
  return bindings.join('/');
}

function footerText(keyBindings: EffectiveKeyBindings): string {
  const movement = `${keyBindings.selectNext[0]}/${keyBindings.selectPrevious[0]}`;
  return `${movement} move  ${formatBindings(keyBindings.openDiff)} diff  ${formatBindings(
    keyBindings.runReviewCommand
  )} review command  ${formatBindings(
    keyBindings.composeReviewSubmission
  )} submit review  ${formatBindings(keyBindings.showHelp)} help`;
}

function fileSummary(files: number): string {
  return `${files} ${files === 1 ? 'file' : 'files'}`;
}

function relativeAge(value: string, now = Date.now()): string {
  const elapsed = Math.max(0, now - Date.parse(value));
  if (!Number.isFinite(elapsed)) return value;
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function useSystemTheme(): SystemTheme {
  const renderer = useRenderer();
  const [theme, setTheme] = useState<SystemTheme>(fallbackSystemTheme);

  useEffect(() => {
    let active = true;
    void renderer
      .getPalette({ size: 16 })
      .then((colors) => {
        const detectedTheme = generateSystemTheme(colors);
        if (active && detectedTheme !== undefined) setTheme(detectedTheme);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [renderer]);

  return theme;
}

function generateSystemTheme(colors: TerminalColors): SystemTheme | undefined {
  const background = colors.defaultBackground ?? colors.palette[0];
  if (!background) return undefined;

  const bg = RGBA.fromHex(background);
  const foreground = colors.defaultForeground ?? colors.palette[7] ?? '#c0c0c0';
  const fg = RGBA.fromHex(foreground);
  const isDark = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b <= 0.5;
  const color = (index: number, fallback: string) =>
    RGBA.fromHex(colors.palette[index] ?? fallback);

  return {
    success: color(2, '#008000'),
    error: color(1, '#800000'),
    info: color(6, '#008080'),
    secondary: color(5, '#800080'),
    warning: color(3, '#808000'),
    textMuted: generateMutedTextColor(bg, isDark),
    foreground: fg,
    background: bg,
    subtleSurface: tint(bg, fg, isDark ? 0.14 : 0.1),
  };
}

function createFallbackSystemTheme(): SystemTheme {
  const colors = normalizeTerminalPalette();
  const bg = colors.defaultBackground;
  const fg = colors.defaultForeground;
  const isDark = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b <= 0.5;
  return {
    success: colors.palette[2] ?? fg,
    error: colors.palette[1] ?? fg,
    info: colors.palette[6] ?? fg,
    secondary: colors.palette[5] ?? fg,
    warning: colors.palette[3] ?? fg,
    textMuted: generateMutedTextColor(bg, isDark),
    foreground: fg,
    background: bg,
    subtleSurface: tint(bg, fg, isDark ? 0.14 : 0.1),
  };
}

const fallbackSystemTheme = createFallbackSystemTheme();

function tint(base: RGBA, overlay: RGBA, alpha: number): RGBA {
  return RGBA.fromInts(
    Math.round((base.r + (overlay.r - base.r) * alpha) * 255),
    Math.round((base.g + (overlay.g - base.g) * alpha) * 255),
    Math.round((base.b + (overlay.b - base.b) * alpha) * 255)
  );
}

function generateMutedTextColor(background: RGBA, isDark: boolean): RGBA {
  const backgroundLuminance =
    0.299 * background.r * 255 +
    0.587 * background.g * 255 +
    0.114 * background.b * 255;

  const gray = isDark
    ? backgroundLuminance < 10
      ? 180
      : Math.min(Math.floor(160 + backgroundLuminance * 0.3), 200)
    : backgroundLuminance > 245
      ? 75
      : Math.max(Math.floor(100 - (255 - backgroundLuminance) * 0.2), 60);

  return RGBA.fromInts(gray, gray, gray);
}
