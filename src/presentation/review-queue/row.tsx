import type { PullRequestSummary } from '../../domain/pull-request.ts';
import type { PullRequestList } from '../../github/types.ts';
import { reviewStateColor, type SystemTheme } from '../terminal/theme.ts';
import {
  checkSummary,
  stackLabel,
  relativeAge,
  fileSummary,
  reviewDecisionLabel,
} from '../pull-request-format.ts';

export function ReviewQueueRow({
  id,
  pullRequest,
  list,
  rowHeight,
  titleHeight,
  metadataHeight,
  statusHeight,
  underCursor,
  theme,
}: {
  readonly id: string;
  readonly pullRequest: PullRequestSummary;
  readonly list: PullRequestList;
  readonly rowHeight: number;
  readonly titleHeight: number;
  readonly metadataHeight: number;
  readonly statusHeight: number;
  readonly underCursor: boolean;
  readonly theme: SystemTheme | undefined;
}) {
  const decision = pullRequest.reviewDecision;
  const checks = checkSummary(pullRequest.checks);
  return (
    <box
      id={id}
      width="100%"
      height={rowHeight}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      flexDirection="column"
      backgroundColor={underCursor ? theme?.subtleSurface : undefined}
    >
      <text
        height={titleHeight}
        flexShrink={0}
        wrapMode="char"
        overflow="hidden"
      >
        <span fg={theme?.success}>● </span>
        <strong>{pullRequest.title}</strong>
        {list === 'authored' && pullRequest.isDraft ? (
          <span fg={theme?.warning}> · draft</span>
        ) : null}
      </text>
      <text
        height={metadataHeight}
        flexShrink={0}
        wrapMode="char"
        overflow="hidden"
      >
        {'  '}
        <span fg={theme?.info}>{pullRequest.repository}</span>
        <span fg={theme?.textMuted}>
          {' '}
          #{pullRequest.number}
          {stackLabel(pullRequest)} opened by{' '}
        </span>
        <span fg={theme?.secondary}>{pullRequest.author}</span>
        <span fg={theme?.textMuted}>
          {' '}
          · updated {relativeAge(pullRequest.updatedAt)} ·{' '}
          {fileSummary(pullRequest.changedFiles)}{' '}
        </span>
        <span fg={theme?.success}>+{pullRequest.additions}</span>{' '}
        <span fg={theme?.error}>-{pullRequest.deletions}</span>
      </text>
      <text
        height={statusHeight}
        flexShrink={0}
        wrapMode="char"
        overflow="hidden"
      >
        {'  '}
        <span fg={reviewStateColor(decision || 'none', theme)}>
          {reviewDecisionLabel(decision)}
        </span>
        <span fg={theme?.textMuted}> · </span>
        <span fg={theme?.[checks.tone]}>{checks.label}</span>
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
