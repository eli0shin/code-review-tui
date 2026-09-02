import {
  BoxRenderable,
  CliRenderEvents,
  CodeRenderable,
  createCliRenderer,
  normalizeTerminalPalette,
  RGBA,
  SyntaxStyle,
  TextAttributes,
  TextBufferRenderable,
  TextTableRenderable,
  type KeyEvent,
  type MarkdownOptions,
  type ScrollBoxRenderable,
  type Selection,
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

type SubmissionDraft = {
  readonly target: PullRequestSummary;
  readonly message: string;
  readonly action?: ReviewDecision;
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

type QueueNotice = {
  readonly message: string;
  readonly tone?: 'error' | 'success';
  readonly refreshFailure?: GitHubFailure;
  readonly queueSuccessSequence?: number;
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
  readonly selectionForeground: RGBA;
  readonly selectionBackground: RGBA;
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
  useCopyCompletedSelection(theme);
  const terminal = useTerminalDimensions();
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState(0);
  const [draft, setDraft] = useState<SubmissionDraft>();
  const [modalTarget, setModalTarget] = useState<PullRequestSummary>();
  const [detailErrorsOpen, setDetailErrorsOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [dismissedFailureKey, setDismissedFailureKey] = useState<string>();
  const [notice, setNotice] = useState<QueueNotice>();
  const [herdrActionFailure, setHerdrActionFailure] =
    useState<HerdrActionFailure>();
  const editorRef = useRef<TextareaRenderable>(null);
  const failureViewerRef = useRef<ScrollBoxRenderable>(null);
  const detailsViewportRef = useRef<ScrollBoxRenderable>(null);
  const queueSuccessSequenceRef = useRef(0);
  const draftOpenRef = useRef(false);
  const submissionActiveRef = useRef(false);
  const submissionIdRef = useRef(0);
  const submissionControllerRef = useRef<AbortController | undefined>(
    undefined
  );
  const queueQuery = useQuery<ReviewQueue, GitHubFailure>({
    queryKey: ['reviewQueue'],
    async queryFn({ signal }) {
      const result = await github.loadReviewQueue(signal);
      if (!result.ok) throw result.failure;
      queueSuccessSequenceRef.current += 1;
      return result.value;
    },
    refetchInterval: refreshIntervalMs,
  });
  const queue = queueQuery.data ?? emptyReviewQueue;
  const rememberedRefreshFailure =
    notice?.queueSuccessSequence === queueSuccessSequenceRef.current
      ? notice.refreshFailure
      : undefined;
  const queueFailure = queueQuery.error ?? rememberedRefreshFailure ?? null;
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
    (notice === undefined
      ? 0
      : renderedRows(notice.message, queueStatusWidth)) +
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
    queueFailure !== null &&
    requiresFailureOverlay(
      queue.length === 0
        ? `${failureMessage(queueFailure)} · ${formatBindings(
            keyBindings.refresh
          )} retry`
        : `Review Queue not refreshed: ${failureMessage(queueFailure)}`,
      queue.length === 0 ? terminal.width : queueStatusWidth,
      queue.length === 0 ? terminal.height - 2 : 3 - occupiedQueueStatusRows
    ) &&
    githubFailureKey(queueFailure) !== dismissedFailureKey
      ? {
          key: githubFailureKey(queueFailure),
          title:
            queue.length === 0
              ? 'Review Queue unavailable'
              : 'Review Queue not refreshed',
          message: failureMessage(queueFailure),
        }
      : undefined;

  useEffect(() => {
    failureViewerRef.current?.scrollTo(0);
  }, [activeFailure?.key, detailErrorsOpen]);

  const closeDraft = (): void => {
    draftOpenRef.current = false;
    submissionIdRef.current += 1;
    submissionControllerRef.current?.abort();
    submissionControllerRef.current = undefined;
    submissionActiveRef.current = false;
    setDraft(undefined);
  };

  const submitDraft = async (
    submission: SubmissionDraft,
    action: ReviewDecision,
    message: string
  ): Promise<void> => {
    if (!draftOpenRef.current || submissionActiveRef.current) return;
    const attempt = { ...submission, message, action };
    if (action !== 'approve' && !/\S/.test(message)) {
      setDraft({
        ...attempt,
        validation: `${reviewActionLabel(action)} requires a nonblank message.`,
      });
      return;
    }
    submissionActiveRef.current = true;
    const submissionId = submissionIdRef.current + 1;
    submissionIdRef.current = submissionId;
    const controller = new AbortController();
    submissionControllerRef.current = controller;

    setDraft({
      ...attempt,
      failure: undefined,
      validation: undefined,
      inFlight: true,
    });
    const result = await github.submitReview(
      { url: attempt.target.url, message, decision: action },
      controller.signal
    );
    if (submissionIdRef.current !== submissionId) return;
    submissionActiveRef.current = false;
    submissionControllerRef.current = undefined;
    if (!result.ok) {
      setDraft({ ...attempt, failure: result.failure, inFlight: false });
      return;
    }

    const successNotice = submissionSuccessNotice(attempt.target, action);
    draftOpenRef.current = false;
    setDraft(undefined);
    setNotice({ message: `${successNotice} Refreshing Review Queue…` });
    const refresh = await queueQuery.refetch();
    if (refresh.isError) {
      setNotice({
        message: `${successNotice} Review Queue could not be refreshed.`,
        refreshFailure: refresh.error,
        queueSuccessSequence: queueSuccessSequenceRef.current,
      });
    }
  };

  const openPullRequestInBrowser = async (
    pullRequest: PullRequestSummary
  ): Promise<void> => {
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
      handleSubmissionKey(
        key,
        draft,
        editorRef.current?.plainText ?? draft.message,
        submitDraft,
        closeDraft
      );
      return;
    }

    if (activeFailure !== undefined) {
      key.preventDefault();
      key.stopPropagation();
      const viewer = failureViewerRef.current;
      if (queueActionForKey(key, keyBindings) === 'refresh') {
        setNotice(undefined);
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
      setNotice(undefined);
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
    if (action === 'openInBrowser') {
      void openPullRequestInBrowser(highlightedPullRequest);
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
      draftOpenRef.current = true;
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
            refreshFailure={queueFailure}
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
          onClose={closeDraft}
          terminal={terminal}
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
  readonly notice: QueueNotice | undefined;
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
          {notice !== undefined || refreshFailure !== null ? (
            <text width="100%" wrapMode="char">
              {notice !== undefined ? (
                <span
                  fg={notice.tone === 'error' ? theme?.error : theme?.success}
                >
                  {notice.message}
                </span>
              ) : null}
              {notice !== undefined && refreshFailure !== null ? '\n' : null}
              {refreshFailure !== null ? (
                <span fg={theme?.error}>
                  Review Queue not refreshed: {failureMessage(refreshFailure)}
                </span>
              ) : null}
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
  const resolvedTheme = theme ?? fallbackSystemTheme;
  const metadata = sources?.metadata;
  const reviews = sources?.reviews;
  const checks = sources?.checks;
  const issueComments = sources?.issueComments;
  const inlineComments = sources?.inlineComments;
  const conversation = collectConversation(sources);
  const markdownStyle = useMarkdownStyle(resolvedTheme);

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
      <text fg={theme?.foreground}>
        <strong>Pull request details · </strong>
        <span fg={theme?.info}>
          <strong>{target.repository}</strong>
        </span>
        <strong> #{target.number}</strong>
      </text>
      {loading ? <text fg={theme?.info}>Refreshing details…</text> : null}
      <box height={1} />

      <text fg={theme?.foreground}>
        <strong>Pull request</strong>
      </text>
      {metadata === undefined ? (
        <text fg={theme?.textMuted}>Loading metadata…</text>
      ) : metadata.ok ? (
        <>
          <text width="100%" wrapMode="char" fg={theme?.foreground}>
            <strong>{metadata.value.title}</strong>
          </text>
          <text fg={theme?.foreground}>
            <span fg={theme?.secondary}>{metadata.value.author}</span> ·{' '}
            {metadata.value.state}
            {metadata.value.isDraft ? ' · draft' : ''}
          </text>
          <text fg={theme?.foreground}>
            <span fg={theme?.textMuted}>
              {metadata.value.baseRefName} ← {metadata.value.headRefName} ·{' '}
              {fileSummary(metadata.value.changedFiles)} ·{' '}
            </span>
            <span fg={theme?.success}>+{metadata.value.additions}</span>{' '}
            <span fg={theme?.error}>-{metadata.value.deletions}</span>
          </text>
          <text fg={theme?.foreground}>
            Labels:{' '}
            <span fg={theme?.warning}>
              {metadata.value.labels.length === 0
                ? 'none'
                : metadata.value.labels.join(', ')}
            </span>
          </text>
        </>
      ) : (
        <Unavailable label="Pull request metadata" theme={theme} />
      )}
      <box height={1} />

      <text fg={theme?.foreground}>
        <strong>Reviewers</strong>
      </text>
      {metadata?.ok ? (
        <>
          <text fg={theme?.foreground}>
            Decision:{' '}
            <span
              fg={reviewStateColor(
                metadata.value.reviewDecision || 'none',
                theme
              )}
            >
              {metadata.value.reviewDecision || 'none'}
            </span>
          </text>
          <text fg={theme?.foreground}>
            Requested:{' '}
            {metadata.value.reviewRequests.length === 0
              ? 'none'
              : metadata.value.reviewRequests.map((reviewer, index) => (
                  <span key={reviewer} fg={theme?.secondary}>
                    {index === 0 ? '' : ', '}
                    {reviewer}
                  </span>
                ))}
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
          <text fg={theme?.foreground}>Submitted: none</text>
        ) : (
          reviews.value.map((review) => (
            <text
              key={`${review.author}:${review.submittedAt}:${review.state}:${review.body}`}
              fg={theme?.foreground}
            >
              Submitted: <span fg={theme?.secondary}>{review.author}</span>
              <span fg={theme?.textMuted}> · </span>
              <span fg={reviewStateColor(review.state, theme)}>
                {review.state}
              </span>
            </text>
          ))
        )
      ) : (
        <Unavailable label="Submitted reviewers" theme={theme} />
      )}
      <box height={1} />

      <text fg={theme?.foreground}>
        <strong>Checks</strong>
      </text>
      {checks === undefined ? (
        <text fg={theme?.textMuted}>Loading checks…</text>
      ) : checks.ok ? (
        checks.value.length === 0 ? (
          <text fg={theme?.foreground}>None</text>
        ) : (
          checks.value.map((check) => (
            <text key={`${check.name}:${check.state}`} fg={theme?.foreground}>
              {check.name} ·{' '}
              <span fg={checkStateColor(check.state, theme)}>
                {check.state}
              </span>
            </text>
          ))
        )
      ) : (
        <Unavailable label="Checks" theme={theme} />
      )}
      <box height={1} />

      <text fg={theme?.foreground}>
        <strong>Description</strong>
      </text>
      {metadata === undefined ? (
        <text fg={theme?.textMuted}>Loading description…</text>
      ) : metadata.ok ? (
        <MarkdownBody
          body={metadata.value.body || 'No description provided.'}
          syntaxStyle={markdownStyle}
          theme={resolvedTheme}
        />
      ) : (
        <Unavailable label="Description" theme={theme} />
      )}
      <box height={1} />

      <text fg={theme?.foreground}>
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
          <text fg={theme?.foreground}>
            <strong>{entry.kind} · </strong>
            <span fg={theme?.secondary}>
              <strong>{entry.author}</strong>
            </span>
            <span fg={theme?.textMuted}>
              <strong> · {entry.timestamp}</strong>
            </span>
            {entry.state === undefined ? null : (
              <span fg={reviewStateColor(entry.state, theme)}>
                <strong> · {entry.state}</strong>
              </span>
            )}
          </text>
          {entry.context === undefined ? null : (
            <text fg={theme?.textMuted}>{entry.context}</text>
          )}
          <MarkdownBody
            body={entry.body}
            syntaxStyle={markdownStyle}
            theme={resolvedTheme}
          />
        </box>
      ))}
      {conversation.length === 0 &&
      issueComments?.ok &&
      reviews?.ok &&
      inlineComments?.ok ? (
        <text fg={theme?.foreground}>None</text>
      ) : null}
      <box height={1} />
      <text fg={theme?.foreground} attributes={TextAttributes.DIM}>
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

function MarkdownBody({
  body,
  syntaxStyle,
  theme,
}: {
  readonly body: string;
  readonly syntaxStyle: SyntaxStyle;
  readonly theme: SystemTheme;
}) {
  const renderNode = useMemo(
    () =>
      createMarkdownNodeRenderer(
        theme.selectionBackground,
        theme.selectionForeground
      ),
    [theme.selectionBackground, theme.selectionForeground]
  );

  return (
    <markdown
      content={body}
      syntaxStyle={syntaxStyle}
      renderNode={renderNode}
      width="100%"
      fg={theme.foreground}
      bg={theme.background}
      conceal
      concealCode={false}
      streaming
      internalBlockMode="top-level"
    />
  );
}

function createMarkdownNodeRenderer(
  selectionBackground: RGBA,
  selectionForeground: RGBA
): NonNullable<MarkdownOptions['renderNode']> {
  return (token, context) => {
    if (token.type !== 'table') return renderMarkdownNode(token, context);
    const table = context.defaultRender();
    if (!(table instanceof TextTableRenderable)) return table;

    return new TextTableRenderable(table.ctx, {
      id: table.id,
      content: table.content,
      width: '100%',
      columnWidthMode: table.columnWidthMode,
      columnFitter: table.columnFitter,
      wrapMode: table.wrapMode,
      cellPaddingX: table.cellPaddingX,
      cellPaddingY: table.cellPaddingY,
      columnGap: table.columnGap,
      border: table.border,
      outerBorder: table.outerBorder,
      showBorders: table.showBorders,
      borderStyle: table.borderStyle,
      borderColor: table.borderColor,
      selectable: table.selectable,
      selectionBg: selectionBackground,
      selectionFg: selectionForeground,
    });
  };
}

const renderMarkdownNode: NonNullable<MarkdownOptions['renderNode']> = (
  token,
  context
) => {
  if (token.type !== 'code' && token.type !== 'blockquote') return undefined;
  const renderable = context.defaultRender();
  const code =
    renderable instanceof CodeRenderable
      ? renderable
      : renderable instanceof BoxRenderable
        ? renderable
            .getChildren()
            .find((child) => child instanceof CodeRenderable)
        : undefined;
  if (code instanceof CodeRenderable) code.drawUnstyledText = true;
  return renderable;
};

function useMarkdownStyle(theme: SystemTheme): SyntaxStyle {
  const syntaxStyle = useMemo(
    () =>
      SyntaxStyle.fromStyles({
        default: { fg: theme.foreground },
        conceal: { fg: theme.textMuted },
        'markup.heading': { fg: theme.info, bold: true },
        'markup.strong': { fg: theme.foreground, bold: true },
        'markup.italic': { fg: theme.foreground, italic: true },
        'markup.strikethrough': { fg: theme.textMuted, dim: true },
        'markup.raw': { fg: theme.warning },
        'markup.list': { fg: theme.info },
        'markup.quote': { fg: theme.textMuted, italic: true },
        'markup.link': { fg: theme.secondary },
        'markup.link.label': { fg: theme.secondary, underline: true },
        'markup.link.url': { fg: theme.textMuted, underline: true },
      }),
    [theme]
  );

  useEffect(
    () => () => {
      syntaxStyle.destroy();
    },
    [syntaxStyle]
  );

  return syntaxStyle;
}

function reviewStateColor(
  state: string,
  theme: SystemTheme | undefined
): RGBA | undefined {
  if (theme === undefined) return undefined;
  const normalizedState = state.toUpperCase();
  if (normalizedState === 'APPROVED') return theme.success;
  if (normalizedState === 'CHANGES_REQUESTED') return theme.error;
  if (normalizedState === 'COMMENTED' || normalizedState === 'PENDING') {
    return theme.info;
  }
  return theme.foreground;
}

function checkStateColor(
  state: string,
  theme: SystemTheme | undefined
): RGBA | undefined {
  if (theme === undefined) return undefined;
  const normalizedState = state.toUpperCase();
  if (normalizedState === 'SUCCESS') return theme.success;
  if (
    normalizedState === 'FAILURE' ||
    normalizedState === 'ERROR' ||
    normalizedState === 'CANCELLED'
  ) {
    return theme.error;
  }
  return theme.info;
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
  readonly kind: 'Issue comment' | 'Submitted review' | 'Inline review comment';
  readonly author: string;
  readonly timestamp: string;
  readonly state?: string;
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
        kind: 'Issue comment' as const,
        author: comment.author,
        body: comment.body,
      }))
    );
  }
  if (sources.reviews.ok) {
    entries.push(
      ...sources.reviews.value.map((review) => ({
        key: `review:${review.author}:${review.submittedAt}:${review.state}:${review.body}`,
        timestamp: review.submittedAt,
        kind: 'Submitted review' as const,
        author: review.author,
        state: review.state,
        body: review.body,
      }))
    );
  }
  if (sources.inlineComments.ok) {
    entries.push(
      ...sources.inlineComments.value.map((comment) => ({
        key: `inline:${comment.id}`,
        timestamp: comment.createdAt,
        kind: 'Inline review comment' as const,
        author: comment.author,
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
      <text flexShrink={0} fg={theme?.foreground}>
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
          <text
            key={line.key}
            width="100%"
            wrapMode="char"
            fg={theme?.foreground}
          >
            {line.text}
          </text>
        ))}
        <box height={1} />
      </scrollbox>
      <text
        flexShrink={0}
        fg={theme?.foreground}
        attributes={TextAttributes.DIM}
      >
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
      height={15}
      zIndex={10}
      border
      borderColor={theme?.foreground}
      backgroundColor={theme?.background}
      padding={1}
      flexDirection="column"
    >
      <text fg={theme?.foreground}>
        <strong>Review Queue keys</strong>
      </text>
      <text fg={theme?.foreground}>{line('selectPrevious', 'previous')}</text>
      <text fg={theme?.foreground}>{line('selectNext', 'next')}</text>
      <text fg={theme?.foreground}>{line('openDetails', 'open details')}</text>
      <text fg={theme?.foreground}>
        {line('openInBrowser', 'open in browser')}
      </text>
      <text fg={theme?.foreground}>{line('openDiff', 'open diff')}</text>
      <text fg={theme?.foreground}>
        {line('runReviewCommand', 'run Review Command')}
      </text>
      <text fg={theme?.foreground}>
        {line('composeReviewSubmission', 'compose Review Submission')}
      </text>
      <text fg={theme?.foreground}>{line('refresh', 'refresh')}</text>
      <text fg={theme?.foreground}>{line('quit', 'quit')}</text>
      <text fg={theme?.foreground} attributes={TextAttributes.DIM}>
        Esc close
      </text>
    </box>
  );
}

function SubmissionModal({
  draft,
  editorRef,
  setDraft,
  onClose,
  terminal,
  theme,
}: {
  readonly draft: SubmissionDraft;
  readonly editorRef: React.RefObject<TextareaRenderable | null>;
  readonly setDraft: React.Dispatch<
    React.SetStateAction<SubmissionDraft | undefined>
  >;
  readonly onClose: () => void;
  readonly terminal: { readonly width: number; readonly height: number };
  readonly theme: SystemTheme | undefined;
}) {
  const width = Math.max(1, Math.min(78, terminal.width - 2));
  const height = Math.max(1, Math.min(18, terminal.height));
  const status = submissionStatus(draft, theme);
  return (
    <box
      position="absolute"
      left={Math.max(0, Math.floor((terminal.width - width) / 2))}
      top={Math.max(0, Math.floor((terminal.height - height) / 2))}
      width={width}
      height={height}
      zIndex={20}
      border
      borderColor={theme?.foreground}
      backgroundColor={theme?.background}
      paddingTop={0}
      paddingBottom={0}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="column"
    >
      <text fg={theme?.foreground}>
        <span fg={theme?.info}>
          <strong>{draft.target.repository}</strong>
        </span>
        <strong>{` #${draft.target.number}`}</strong>
      </text>
      <text fg={theme?.foreground}>{draft.target.title}</text>
      <text> </text>
      <textarea
        ref={editorRef}
        initialValue={draft.message}
        focused={!draft.inFlight}
        flexGrow={1}
        textColor={theme?.foreground}
        backgroundColor={theme?.background}
        focusedTextColor={theme?.foreground}
        focusedBackgroundColor={theme?.background}
        onContentChange={() => {
          const message = editorRef.current?.plainText ?? '';
          setDraft((current) =>
            current === undefined
              ? current
              : {
                  ...current,
                  message,
                  action: current.inFlight ? current.action : undefined,
                  validation: undefined,
                  failure: current.inFlight ? current.failure : undefined,
                }
          );
        }}
        onKeyDown={(key) => {
          if (key.name !== 'escape') return;
          stopKey(key);
          onClose();
        }}
      />
      <text fg={status.color}>{status.message}</text>
      <SubmissionHints narrow={width < 78} theme={theme} />
    </box>
  );
}

function SubmissionHints({
  narrow,
  theme,
}: {
  readonly narrow: boolean;
  readonly theme: SystemTheme | undefined;
}) {
  if (narrow) {
    return (
      <box flexDirection="column">
        <text fg={theme?.textMuted}>
          <strong>^A</strong> Approve{'   '}
          <strong>^C</strong> Comment
        </text>
        <text fg={theme?.textMuted}>
          <strong>^R</strong> Request changes{'   '}
          <strong>Esc</strong> Discard
        </text>
      </box>
    );
  }
  return (
    <box flexDirection="row" justifyContent="space-between">
      <text fg={theme?.textMuted}>
        <strong>Ctrl+A</strong> Approve
      </text>
      <text fg={theme?.textMuted}>
        <strong>Ctrl+C</strong> Comment
      </text>
      <text fg={theme?.textMuted}>
        <strong>Ctrl+R</strong> Request changes
      </text>
      <text fg={theme?.textMuted}>
        <strong>Esc</strong> Discard
      </text>
    </box>
  );
}

function handleSubmissionKey(
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

function stopKey(key: KeyEvent): void {
  key.preventDefault();
  key.stopPropagation();
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
  return { target, message: '', inFlight: false };
}

function submissionStatus(
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

function reviewActionLabel(action: ReviewDecision): string {
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

function submissionSuccessNotice(
  pullRequest: PullRequestSummary,
  action: ReviewDecision
): string {
  const target = `${pullRequest.repository} #${pullRequest.number}.`;
  switch (action) {
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
  return `${movement} move  ${formatBindings(keyBindings.openDetails)} details  ${formatBindings(
    keyBindings.openInBrowser
  )} browser  ${formatBindings(keyBindings.openDiff)} diff  ${formatBindings(
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

function useCopyCompletedSelection(theme: SystemTheme): void {
  const renderer = useRenderer();

  useEffect(() => {
    const handleSelection = (selection: Selection) => {
      for (const renderable of selection.selectedRenderables) {
        if (renderable instanceof TextBufferRenderable) {
          renderable.selectionBg = theme.selectionBackground;
          renderable.selectionFg = theme.selectionForeground;
        }
      }

      if (selection.isDragging) return;
      const text = selection.getSelectedText();
      if (text.trim().length === 0) return;
      renderer.copyToClipboardOSC52(text);
    };

    renderer.on(CliRenderEvents.SELECTION, handleSelection);
    return () => {
      renderer.off(CliRenderEvents.SELECTION, handleSelection);
    };
  }, [renderer, theme.selectionBackground, theme.selectionForeground]);
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
    foreground: RGBA.defaultForeground(),
    background: RGBA.defaultBackground(),
    selectionForeground: colors.highlightForeground
      ? RGBA.fromHex(colors.highlightForeground)
      : bg,
    selectionBackground: colors.highlightBackground
      ? RGBA.fromHex(colors.highlightBackground)
      : fg,
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
    foreground: RGBA.defaultForeground(),
    background: RGBA.defaultBackground(),
    selectionForeground: bg,
    selectionBackground: fg,
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
