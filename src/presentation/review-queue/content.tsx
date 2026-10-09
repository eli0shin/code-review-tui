import { TextAttributes, type ScrollBoxRenderable } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { EffectiveKeyBindings } from '../../configuration/index.ts';
import type { ReviewQueue } from '../../domain/pull-request.ts';
import type { GitHubFailure, PullRequestList } from '../../github/types.ts';
import type { SystemTheme } from '../terminal/theme.ts';
import { charWrappedRows } from '../terminal/text-layout.ts';
import { formatBindings, footerText } from '../terminal/keys.ts';
import {
  failureMessage,
  herdrFailureMessage,
} from '../terminal/diagnostics.tsx';
import type { QueueNotice, HerdrActionFailure } from './use-queue-feedback.ts';
import { rowStatusText, rowMetadataText } from '../pull-request-format.ts';
import { ReviewQueueRow } from './row.tsx';

export function ReviewQueueContent({
  list,
  queue,
  cursorPosition,
  pageStatusText,
  scopeLabel,
  scopeDiagnostic,
  resolvingRepository,
  refreshing,
  refreshFailure,
  notice,
  herdrActionFailure,
  keyBindings,
  theme,
}: {
  readonly list: PullRequestList;
  readonly queue: ReviewQueue;
  readonly cursorPosition: number;
  readonly pageStatusText: string;
  readonly scopeLabel: string;
  readonly scopeDiagnostic: string | undefined;
  readonly resolvingRepository: boolean;
  readonly refreshing: boolean;
  readonly refreshFailure: GitHubFailure | null;
  readonly notice: QueueNotice | undefined;
  readonly herdrActionFailure: HerdrActionFailure | undefined;
  readonly keyBindings: EffectiveKeyBindings;
  readonly theme: SystemTheme | undefined;
}) {
  const queueViewportRef = useRef<ScrollBoxRenderable>(null);
  const terminal = useTerminalDimensions();
  const rows = useMemo(
    () =>
      queue.map((pullRequest) => {
        const width = terminal.width - 2;
        const titleHeight = charWrappedRows(
          `● ${pullRequest.title}${list === 'authored' && pullRequest.isDraft ? ' · draft' : ''}`,
          width
        );
        const statusHeight = charWrappedRows(rowStatusText(pullRequest), width);
        const metadataHeight = charWrappedRows(
          rowMetadataText(pullRequest),
          width
        );
        return {
          pullRequest,
          titleHeight,
          statusHeight,
          metadataHeight,
          height: 2 + titleHeight + statusHeight + metadataHeight,
        };
      }),
    [queue, list, terminal.width]
  );
  const keepCursorVisible = useCallback(
    (viewport: ScrollBoxRenderable | null = queueViewportRef.current) => {
      if (viewport === null) return;
      const rowTop = rows
        .slice(0, cursorPosition)
        .reduce((total, row) => total + row.height, 0);
      const rowHeight = rows[cursorPosition]?.height ?? 0;
      const rowBottom = rowTop + rowHeight;
      const viewportTop = viewport.scrollTop;
      const viewportBottom = viewportTop + viewport.viewport.height;
      if (rowTop < viewportTop || rowHeight > viewport.viewport.height) {
        viewport.scrollTop = rowTop;
      } else if (rowBottom > viewportBottom) {
        viewport.scrollTop = rowBottom - viewport.viewport.height;
      }
    },
    [cursorPosition, rows]
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

  const hasStatus =
    notice !== undefined ||
    refreshFailure !== null ||
    herdrActionFailure !== undefined ||
    scopeDiagnostic !== undefined ||
    resolvingRepository;

  return (
    <box flexGrow={1} flexDirection="column">
      <box
        height={hasStatus ? 5 : 2}
        flexShrink={0}
        flexDirection="column"
        paddingBottom={1}
        overflow="hidden"
      >
        <box
          width="100%"
          height={1}
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          gap={1}
        >
          <text flexShrink={0}>
            <strong>
              {list === 'reviewQueue' ? 'Review requests' : 'My PRs'}
            </strong>{' '}
            <span attributes={TextAttributes.DIM}>
              {scopeLabel} {queue.length} open
            </span>
          </text>
          <text attributes={TextAttributes.DIM}>
            {refreshing ? 'refreshing…' : 'updated'}{' '}
            {formatBindings(keyBindings.refresh)} refresh
          </text>
        </box>
        <scrollbox
          id="review-status"
          height={hasStatus ? 3 : 0}
          visible={hasStatus}
          scrollY
          viewportCulling
          contentOptions={{ flexDirection: 'column', paddingRight: 1 }}
        >
          {scopeDiagnostic !== undefined ? (
            <text width="100%" wrapMode="char" fg={theme?.error}>
              {scopeDiagnostic}
            </text>
          ) : null}
          {resolvingRepository ? (
            <text width="100%" wrapMode="char" attributes={TextAttributes.DIM}>
              Resolving launch repository…
            </text>
          ) : null}
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
                  {list === 'reviewQueue' ? 'Review Queue' : 'My PRs'} not
                  refreshed: {failureMessage(refreshFailure)}
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
        scrollbarOptions={{ visible: false }}
        onSizeChange={handleViewportSizeChange}
        flexGrow={1}
        flexShrink={1}
        minHeight={4}
        scrollY
        viewportCulling
        contentOptions={{ flexDirection: 'column' }}
      >
        {rows.map(
          (
            { pullRequest, height, titleHeight, metadataHeight, statusHeight },
            index
          ) => (
            <ReviewQueueRow
              key={pullRequest.url}
              id={`review-queue-row-${index}`}
              pullRequest={pullRequest}
              list={list}
              rowHeight={height}
              titleHeight={titleHeight}
              metadataHeight={metadataHeight}
              statusHeight={statusHeight}
              underCursor={index === cursorPosition}
              theme={theme}
            />
          )
        )}
      </scrollbox>
      <text
        flexShrink={0}
        attributes={TextAttributes.DIM}
        paddingLeft={2}
        paddingRight={2}
      >
        {' '}
        {pageStatusText} · {footerText(keyBindings)}
      </text>
    </box>
  );
}
