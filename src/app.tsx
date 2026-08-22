import {
  createCliRenderer,
  normalizeTerminalPalette,
  RGBA,
  TextAttributes,
  type KeyEvent,
  type ScrollBoxRenderable,
  type TerminalColors,
  type TextareaRenderable,
} from '@opentui/core';
import {
  createRoot,
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from '@opentui/react';
import {
  environmentManager,
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  normalizeKeyDescriptor,
  queueActions,
  type EffectiveKeyBindings,
  type ReviewConfiguration,
  type QueueAction,
} from './configuration/index.ts';
import type {
  PullRequestSummary,
  ReviewDecision,
  ReviewQueue,
} from './domain/pull-request.ts';
import { createGitHubCliAdapter } from './github/cli-adapter.ts';
import type {
  GitHub,
  GitHubFailure,
  PullRequestDetailSources,
} from './github/types.ts';
import { runReviewRuntime } from './runtime.ts';
import { createHerdrCliAdapter } from './tools/herdr-adapter.ts';
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
  const terminal = useTerminalDimensions();
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState(0);
  const [draft, setDraft] = useState<SubmissionDraft>();
  const [modalTarget, setModalTarget] = useState<PullRequestSummary>();
  const [detailErrorsOpen, setDetailErrorsOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [dismissedFailureKey, setDismissedFailureKey] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [herdrActionFailure, setHerdrActionFailure] =
    useState<HerdrActionFailure>();
  const editorRef = useRef<TextareaRenderable>(null);
  const failureViewerRef = useRef<ScrollBoxRenderable>(null);
  const detailsViewportRef = useRef<ScrollBoxRenderable>(null);
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
  const detailsUrl = modalTarget?.url;

  const detailsQuery = useQuery<PullRequestDetailSources>({
    queryKey: [...detailsQueryKey, detailsUrl],
    enabled: detailsUrl !== undefined,
    queryFn({ signal }) {
      if (detailsUrl === undefined) {
        throw new Error('A pull request details target URL is required');
      }
      return github.loadPullRequestDetails(detailsUrl, signal);
    },
  });
  const detailFailures = collectDetailFailures(detailsQuery.data);

  const queueStatusWidth = terminal.width - 5;
  const occupiedQueueStatusRows =
    (notice === undefined ? 0 : renderedRows(notice, queueStatusWidth)) +
    (herdrActionFailure === undefined
      ? 0
      : renderedRows(
          `Could not open ${herdrActionFailure.action}: ${herdrFailureMessage(
            herdrActionFailure.failure
          )}${
            herdrActionFailure.failure.stderr
              ? `\n${herdrActionFailure.failure.stderr}`
              : ''
          }`,
          queueStatusWidth
        ));
  const activeFailure =
    modalTarget === undefined &&
    queueQuery.error !== null &&
    requiresFailureOverlay(
      queue.length === 0
        ? `${failureMessage(queueQuery.error)} · ${formatBindings(
            keyBindings.refresh
          )} retry`
        : `Review Queue not refreshed: ${failureMessage(queueQuery.error)}`,
      queue.length === 0 ? terminal.width : queueStatusWidth,
      queue.length === 0 ? terminal.height - 2 : 3 - occupiedQueueStatusRows
    ) &&
    githubFailureKey(queueQuery.error) !== dismissedFailureKey
      ? {
          key: githubFailureKey(queueQuery.error),
          title:
            queue.length === 0
              ? 'Review Queue unavailable'
              : 'Review Queue not refreshed',
          message: failureMessage(queueQuery.error),
        }
      : undefined;

  useEffect(() => {
    failureViewerRef.current?.scrollTo(0);
  }, [activeFailure?.key, detailErrorsOpen]);

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

    if (activeFailure !== undefined) {
      key.preventDefault();
      key.stopPropagation();
      const viewer = failureViewerRef.current;
      if (queueActionForKey(key, keyBindings) === 'refresh') {
        void queueQuery.refetch();
      } else if (key.name === 'escape') {
        setDismissedFailureKey(activeFailure.key);
      } else if (key.name === 'up') viewer?.scrollBy(-1, 'step');
      else if (key.name === 'down') viewer?.scrollBy(1, 'step');
      else if (key.name === 'pageup') viewer?.scrollBy(-1, 'viewport');
      else if (key.name === 'pagedown') viewer?.scrollBy(1, 'viewport');
      else if (key.name === 'home') viewer?.scrollTo(0);
      else if (key.name === 'end') viewer?.scrollTo(viewer.scrollHeight);
      return;
    }

    if (detailErrorsOpen) {
      key.preventDefault();
      key.stopPropagation();
      const viewer = failureViewerRef.current;
      if (key.name === 'escape') setDetailErrorsOpen(false);
      else if (key.name === 'up') viewer?.scrollBy(-1, 'step');
      else if (key.name === 'down') viewer?.scrollBy(1, 'step');
      else if (key.name === 'pageup') viewer?.scrollBy(-1, 'viewport');
      else if (key.name === 'pagedown') viewer?.scrollBy(1, 'viewport');
      else if (key.name === 'home') viewer?.scrollTo(0);
      else if (key.name === 'end') viewer?.scrollTo(viewer.scrollHeight);
      return;
    }

    if (modalTarget !== undefined) {
      key.preventDefault();
      key.stopPropagation();
      const action = queueActionForKey(key, keyBindings);
      const viewport = detailsViewportRef.current;
      if (action === 'quit') {
        setModalTarget(undefined);
      } else if (action === 'refresh') {
        void queryClient.fetchQuery({
          queryKey: [...detailsQueryKey, modalTarget.url],
          queryFn: ({ signal }) =>
            github.loadPullRequestDetails(modalTarget.url, signal),
        });
      } else if (action === 'showErrors' && detailFailures.length > 0) {
        setDetailErrorsOpen(true);
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

    if (action === 'openDetails') {
      void queryClient.invalidateQueries({
        queryKey: [...detailsQueryKey, highlightedPullRequest.url],
        exact: true,
      });
      setModalTarget(highlightedPullRequest);
      return;
    }
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

    if (action !== 'selectPrevious' && action !== 'selectNext') return;
    const offset = action === 'selectNext' ? 1 : -1;
    const nextPosition = cursorPosition + offset;
    if (nextPosition >= 0 && nextPosition < queue.length) {
      setCursor(nextPosition);
    }
  });

  const initialFailure = queueQuery.status === 'error' && queue.length === 0;
  const queueOwnsInput =
    draft === undefined &&
    modalTarget === undefined &&
    !showHelp &&
    activeFailure === undefined;

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
            refreshing={queueQuery.isFetching}
            refreshFailure={queueQuery.error}
            notice={notice}
            herdrActionFailure={herdrActionFailure}
            keyBindings={keyBindings}
            theme={theme}
          />
        )}
      </box>
      {modalTarget !== undefined ? (
        <PullRequestDetailsModal
          ref={detailsViewportRef}
          target={modalTarget}
          sources={detailsQuery.data}
          loading={detailsQuery.isPending || detailsQuery.isFetching}
          keyBindings={keyBindings}
          theme={theme}
        />
      ) : null}
      {showHelp ? (
        <HelpOverlay keyBindings={keyBindings} theme={theme} />
      ) : null}
      {activeFailure !== undefined ? (
        <FailureOverlay
          ref={failureViewerRef}
          title={activeFailure.title}
          message={activeFailure.message}
          theme={theme}
        />
      ) : null}
      {detailErrorsOpen && modalTarget !== undefined ? (
        <FailureOverlay
          ref={failureViewerRef}
          title={`Pull request detail errors · ${modalTarget.repository} #${modalTarget.number}`}
          message={detailFailures
            .map(({ label, failure }) => `${label}: ${failureMessage(failure)}`)
            .join('\n\n')}
          theme={theme}
        />
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
  refreshing,
  refreshFailure,
  notice,
  herdrActionFailure,
  keyBindings,
  theme,
}: {
  readonly queue: ReviewQueue;
  readonly cursorPosition: number;
  readonly refreshing: boolean;
  readonly refreshFailure: GitHubFailure | null;
  readonly notice: string | undefined;
  readonly herdrActionFailure: HerdrActionFailure | undefined;
  readonly keyBindings: EffectiveKeyBindings;
  readonly theme: SystemTheme | undefined;
}) {
  const queueViewportRef = useRef<ScrollBoxRenderable>(null);
  const terminal = useTerminalDimensions();
  const keepCursorVisible = useCallback(
    (viewport: ScrollBoxRenderable | null = queueViewportRef.current) => {
      if (viewport === null) return;
      const rowHeight = 4;
      const rowTop = cursorPosition * rowHeight;
      const rowBottom = rowTop + rowHeight;
      const viewportTop = viewport.scrollTop;
      const viewportBottom = viewportTop + viewport.viewport.height;
      if (rowTop < viewportTop) viewport.scrollTop = rowTop;
      else if (rowBottom > viewportBottom) {
        viewport.scrollTop = rowBottom - viewport.viewport.height;
      }
    },
    [cursorPosition]
  );
  const handleViewportSizeChange = useCallback(
    function (this: ScrollBoxRenderable) {
      keepCursorVisible(this);
    },
    [keepCursorVisible]
  );
  useEffect(keepCursorVisible, [keepCursorVisible, queue.length]);
  useEffect(() => {
    const correction = setTimeout(keepCursorVisible, 0);
    return () => clearTimeout(correction);
  }, [keepCursorVisible, terminal.height, terminal.width]);

  return (
    <box flexGrow={1} flexDirection="column" paddingLeft={2} paddingRight={2}>
      <box height={4} flexShrink={0} flexDirection="column" overflow="hidden">
        <box
          width="100%"
          height={1}
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <text>
            <strong>Review requests</strong>{' '}
            <span attributes={TextAttributes.DIM}>{queue.length} open</span>
          </text>
          <text attributes={TextAttributes.DIM}>
            {refreshing ? 'refreshing…' : 'updated'}{' '}
            {formatBindings(keyBindings.refresh)} refresh
          </text>
        </box>
        <scrollbox
          id="review-status"
          height={3}
          scrollY
          viewportCulling
          contentOptions={{ flexDirection: 'column', paddingRight: 1 }}
        >
          {notice !== undefined ? (
            <text width="100%" wrapMode="char" fg={theme?.success}>
              {notice}
            </text>
          ) : null}
          {refreshFailure !== null ? (
            <text width="100%" wrapMode="char" fg={theme?.error}>
              Review Queue not refreshed: {failureMessage(refreshFailure)}
            </text>
          ) : null}
          {herdrActionFailure !== undefined ? (
            <>
              <text width="100%" wrapMode="char" fg={theme?.error}>
                Could not open {herdrActionFailure.action}:{' '}
                {herdrFailureMessage(herdrActionFailure.failure)}
              </text>
              {herdrActionFailure.failure.stderr ? (
                <text width="100%" wrapMode="char" fg={theme?.error}>
                  {herdrActionFailure.failure.stderr}
                </text>
              ) : null}
            </>
          ) : null}
        </scrollbox>
      </box>
      <scrollbox
        ref={queueViewportRef}
        onSizeChange={handleViewportSizeChange}
        flexGrow={1}
        flexShrink={1}
        minHeight={4}
        scrollY
        viewportCulling
        contentOptions={{ flexDirection: 'column' }}
      >
        {queue.map((pullRequest, index) => (
          <ReviewQueueRow
            key={pullRequest.url}
            id={`review-queue-row-${index}`}
            pullRequest={pullRequest}
            underCursor={index === cursorPosition}
            theme={theme}
          />
        ))}
      </scrollbox>
      <text flexShrink={0} attributes={TextAttributes.DIM}>
        {' '}
        {footerText(keyBindings)}
      </text>
    </box>
  );
}

function ReviewQueueRow({
  id,
  pullRequest,
  underCursor,
  theme,
}: {
  readonly id: string;
  readonly pullRequest: PullRequestSummary;
  readonly underCursor: boolean;
  readonly theme: SystemTheme | undefined;
}) {
  return (
    <box
      id={id}
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
          · updated {relativeAge(pullRequest.updatedAt)} ·{' '}
          {fileSummary(pullRequest.changedFiles)}{' '}
        </span>
        <span fg={theme?.success}>+{pullRequest.additions}</span>{' '}
        <span fg={theme?.error}>-{pullRequest.deletions}</span>
        <span fg={theme?.textMuted}>
          {' '}
          · {pullRequest.commentsCount}{' '}
          {pullRequest.commentsCount === 1 ? 'comment' : 'comments'}
          {pullRequest.labels.length === 0 ? '' : ' · '}
        </span>
        {pullRequest.labels.length === 0 ? null : (
          <span fg={theme?.warning}>{pullRequest.labels.join('  ')}</span>
        )}
      </text>
    </box>
  );
}

function PullRequestDetailsModal({
  ref,
  target,
  sources,
  loading,
  keyBindings,
  theme,
}: {
  readonly ref: React.Ref<ScrollBoxRenderable>;
  readonly target: PullRequestSummary;
  readonly sources: PullRequestDetailSources | undefined;
  readonly loading: boolean;
  readonly keyBindings: EffectiveKeyBindings;
  readonly theme: SystemTheme | undefined;
}) {
  const metadata = sources?.metadata;
  const reviews = sources?.reviews;
  const checks = sources?.checks;
  const issueComments = sources?.issueComments;
  const inlineComments = sources?.inlineComments;
  const conversation = collectConversation(sources);

  return (
    <scrollbox
      ref={ref}
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      zIndex={10}
      backgroundColor={theme?.background}
      scrollY
      viewportCulling
      contentOptions={{
        flexDirection: 'column',
        paddingLeft: 2,
        paddingRight: 2,
      }}
    >
      <text>
        <strong>
          Pull request details · {target.repository} #{target.number}
        </strong>
      </text>
      {loading ? <text fg={theme?.info}>Refreshing details…</text> : null}
      <box height={1} />

      <text>
        <strong>Pull request</strong>
      </text>
      {metadata === undefined ? (
        <text fg={theme?.textMuted}>Loading metadata…</text>
      ) : metadata.ok ? (
        <>
          <text width="100%" wrapMode="char">
            <strong>{metadata.value.title}</strong>
          </text>
          <text>
            {metadata.value.author} · {metadata.value.state}
            {metadata.value.isDraft ? ' · draft' : ''}
          </text>
          <text>
            {metadata.value.baseRefName} ← {metadata.value.headRefName} ·{' '}
            {fileSummary(metadata.value.changedFiles)} · +
            {metadata.value.additions} -{metadata.value.deletions}
          </text>
          <text>
            Labels:{' '}
            {metadata.value.labels.length === 0
              ? 'none'
              : metadata.value.labels.join(', ')}
          </text>
        </>
      ) : (
        <Unavailable label="Pull request metadata" theme={theme} />
      )}
      <box height={1} />

      <text>
        <strong>Reviewers</strong>
      </text>
      {metadata?.ok ? (
        <>
          <text>Decision: {metadata.value.reviewDecision || 'none'}</text>
          <text>
            Requested:{' '}
            {metadata.value.reviewRequests.length === 0
              ? 'none'
              : metadata.value.reviewRequests.join(', ')}
          </text>
        </>
      ) : metadata === undefined ? (
        <text fg={theme?.textMuted}>Loading requested reviewers…</text>
      ) : (
        <Unavailable label="Review decision and requests" theme={theme} />
      )}
      {reviews === undefined ? (
        <text fg={theme?.textMuted}>Loading submitted reviewers…</text>
      ) : reviews.ok ? (
        reviews.value.length === 0 ? (
          <text>Submitted: none</text>
        ) : (
          reviews.value.map((review) => (
            <text
              key={`${review.author}:${review.submittedAt}:${review.state}:${review.body}`}
            >
              Submitted: {review.author} · {review.state}
            </text>
          ))
        )
      ) : (
        <Unavailable label="Submitted reviewers" theme={theme} />
      )}
      <box height={1} />

      <text>
        <strong>Checks</strong>
      </text>
      {checks === undefined ? (
        <text fg={theme?.textMuted}>Loading checks…</text>
      ) : checks.ok ? (
        checks.value.length === 0 ? (
          <text>None</text>
        ) : (
          checks.value.map((check) => (
            <text key={`${check.name}:${check.state}`}>
              {check.name} · {check.state}
            </text>
          ))
        )
      ) : (
        <Unavailable label="Checks" theme={theme} />
      )}
      <box height={1} />

      <text>
        <strong>Description</strong>
      </text>
      {metadata === undefined ? (
        <text fg={theme?.textMuted}>Loading description…</text>
      ) : metadata.ok ? (
        <PlainTextBody
          body={metadata.value.body || 'No description provided.'}
        />
      ) : (
        <Unavailable label="Description" theme={theme} />
      )}
      <box height={1} />

      <text>
        <strong>Conversation</strong>
      </text>
      {reviews === undefined ||
      issueComments === undefined ||
      inlineComments === undefined ? (
        <text fg={theme?.textMuted}>Loading conversation…</text>
      ) : null}
      {issueComments !== undefined && !issueComments.ok ? (
        <Unavailable label="Issue comments" theme={theme} />
      ) : null}
      {reviews !== undefined && !reviews.ok ? (
        <Unavailable label="Submitted reviews" theme={theme} />
      ) : null}
      {inlineComments !== undefined && !inlineComments.ok ? (
        <Unavailable label="Inline review comments" theme={theme} />
      ) : null}
      {conversation.map((entry) => (
        <box key={entry.key} flexDirection="column" marginTop={1}>
          <text>
            <strong>{entry.heading}</strong>
          </text>
          {entry.context === undefined ? null : <text>{entry.context}</text>}
          <PlainTextBody body={entry.body} />
        </box>
      ))}
      {conversation.length === 0 &&
      issueComments?.ok &&
      reviews?.ok &&
      inlineComments?.ok ? (
        <text>None</text>
      ) : null}
      <box height={1} />
      <text attributes={TextAttributes.DIM}>
        {formatBindings(keyBindings.selectPrevious)}/
        {formatBindings(keyBindings.selectNext)} line ·{' '}
        {formatBindings(keyBindings.pagePrevious)}/
        {formatBindings(keyBindings.pageNext)} half-page ·{' '}
        {formatBindings(keyBindings.scrollStart)}/
        {formatBindings(keyBindings.scrollEnd)} start/end ·{' '}
        {formatBindings(keyBindings.refresh)} refresh ·{' '}
        {formatBindings(keyBindings.showErrors)} errors ·{' '}
        {formatBindings(keyBindings.quit)} close
      </text>
      <box height={1} />
    </scrollbox>
  );
}

function PlainTextBody({ body }: { readonly body: string }) {
  return plainTextLines(body).map((line) => (
    <text key={line.key} width="100%" wrapMode="char">
      {line.text}
    </text>
  ));
}

function plainTextLines(
  body: string
): readonly { readonly key: string; readonly text: string }[] {
  let offset = 0;
  return body.split('\n').map((text) => {
    const line = { key: `${offset}:${text}`, text };
    offset += text.length + 1;
    return line;
  });
}

function Unavailable({
  label,
  theme,
}: {
  readonly label: string;
  readonly theme: SystemTheme | undefined;
}) {
  return <text fg={theme?.error}>{label} unavailable · show errors</text>;
}

type ConversationEntry = {
  readonly key: string;
  readonly timestamp: string;
  readonly heading: string;
  readonly context?: string;
  readonly body: string;
};

function collectConversation(
  sources: PullRequestDetailSources | undefined
): readonly ConversationEntry[] {
  if (sources === undefined) return [];
  const entries: ConversationEntry[] = [];
  if (sources.issueComments.ok) {
    entries.push(
      ...sources.issueComments.value.map((comment) => ({
        key: `issue:${comment.id}`,
        timestamp: comment.createdAt,
        heading: `Issue comment · ${comment.author} · ${comment.createdAt}`,
        body: comment.body,
      }))
    );
  }
  if (sources.reviews.ok) {
    entries.push(
      ...sources.reviews.value.map((review) => ({
        key: `review:${review.author}:${review.submittedAt}:${review.state}:${review.body}`,
        timestamp: review.submittedAt,
        heading: `Submitted review · ${review.author} · ${review.submittedAt} · ${review.state}`,
        body: review.body,
      }))
    );
  }
  if (sources.inlineComments.ok) {
    entries.push(
      ...sources.inlineComments.value.map((comment) => ({
        key: `inline:${comment.id}`,
        timestamp: comment.createdAt,
        heading: `Inline review comment · ${comment.author} · ${comment.createdAt}`,
        context: inlineCommentContext(comment),
        body: comment.body,
      }))
    );
  }
  return entries.sort((left, right) =>
    left.timestamp === right.timestamp
      ? left.key.localeCompare(right.key)
      : left.timestamp.localeCompare(right.timestamp)
  );
}

function inlineCommentContext(comment: {
  readonly path: string;
  readonly line: number | null;
  readonly startLine: number | null;
  readonly inReplyToId: string | null;
  readonly resolved: boolean;
  readonly outdated: boolean;
}): string {
  const location =
    comment.line === null
      ? comment.path
      : comment.startLine !== null && comment.startLine !== comment.line
        ? `${comment.path}:${comment.startLine}-${comment.line}`
        : `${comment.path}:${comment.line}`;
  return `${location} · ${comment.inReplyToId === null ? 'thread start' : `reply to ${comment.inReplyToId}`} · ${comment.resolved ? 'resolved' : 'unresolved'} · ${comment.outdated ? 'outdated' : 'current'}`;
}

function collectDetailFailures(
  sources: PullRequestDetailSources | undefined
): readonly { readonly label: string; readonly failure: GitHubFailure }[] {
  if (sources === undefined) return [];
  return (
    [
      ['Pull request metadata', sources.metadata],
      ['Submitted reviews', sources.reviews],
      ['Checks', sources.checks],
      ['Issue comments', sources.issueComments],
      ['Inline review comments', sources.inlineComments],
    ] as const
  ).flatMap(([label, result]) =>
    result.ok ? [] : [{ label, failure: result.failure }]
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
      <text width="100%" wrapMode="char" fg={theme?.textMuted}>
        {detail}
      </text>
    </box>
  );
}

function FailureOverlay({
  ref,
  title,
  message,
  theme,
}: {
  readonly ref: React.Ref<ScrollBoxRenderable>;
  readonly title: string;
  readonly message: string;
  readonly theme: SystemTheme | undefined;
}) {
  return (
    <box
      position="absolute"
      left="15%"
      top="15%"
      width="70%"
      height="70%"
      zIndex={15}
      border
      borderColor={theme?.error}
      backgroundColor={theme?.background}
      padding={1}
      flexDirection="column"
    >
      <text flexShrink={0}>
        <strong>{title}</strong>
      </text>
      <scrollbox
        ref={ref}
        flexGrow={1}
        scrollY
        viewportCulling
        contentOptions={{ flexDirection: 'column', paddingRight: 1 }}
      >
        {failureMessageLines(message).map((line) => (
          <text key={line.key} width="100%" wrapMode="char">
            {line.text}
          </text>
        ))}
        <box height={1} />
      </scrollbox>
      <text flexShrink={0} fg={theme?.textMuted}>
        ↑/↓ scroll PgUp/PgDn page Home/End Esc return
      </text>
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
      <text>{line('openDetails', 'open details')}</text>
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

export async function launchApplication(
  configuration: ReviewConfiguration
): Promise<void> {
  const { githubSearch, reviewCommand, keyBindings } = configuration;
  const herdr = createHerdrCliAdapter({
    reviewCommand,
    workingDirectory: process.cwd(),
    environment: process.env,
  });
  const github = createGitHubCliAdapter(githubSearch);
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    exitSignals: [],
  });
  await runReviewRuntime(renderer, (onQuit) => {
    const root = createRoot(renderer);
    root.render(
      <ReviewQueuePage
        github={github}
        herdr={herdr}
        keyBindings={keyBindings}
        onQuit={onQuit}
      />
    );
    return root;
  });
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
  return message;
}

function renderedRows(message: string, renderedWidth: number): number {
  const width = Math.max(renderedWidth, 1);
  return message.split('\n').reduce((total, line) => {
    const opentuiWidth = Bun.stringWidth(line.replaceAll('\t', '  '));
    return total + Math.max(Math.ceil(opentuiWidth / width), 1);
  }, 0);
}

function requiresFailureOverlay(
  message: string,
  renderedWidth: number,
  availableRows: number
): boolean {
  return renderedRows(message, renderedWidth) > Math.max(availableRows, 0);
}

function githubFailureKey(failure: GitHubFailure): string {
  const url = 'url' in failure ? failure.url : '';
  const stderr = 'stderr' in failure ? failure.stderr : '';
  const diagnostic = 'diagnostic' in failure ? failure.diagnostic : '';
  return `${failure.operation}:${url}:${failure.kind}:${diagnostic}:${stderr}`;
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
  return `${movement} move  ${formatBindings(keyBindings.openDetails)} details  ${formatBindings(keyBindings.openDiff)} diff  ${formatBindings(
    keyBindings.runReviewCommand
  )} review command  ${formatBindings(
    keyBindings.composeReviewSubmission
  )} submit review  ${formatBindings(keyBindings.showHelp)} help`;
}

function failureMessageLines(
  message: string
): readonly { readonly key: string; readonly text: string }[] {
  let offset = 0;
  return message.split('\n').map((text) => {
    const line = { key: `${offset}:${text}`, text };
    offset += text.length + 1;
    return line;
  });
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
