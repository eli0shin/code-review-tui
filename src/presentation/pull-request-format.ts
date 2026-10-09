import type { PullRequestSummary } from '../domain/pull-request.ts';

export function reviewDecisionLabel(decision: string | undefined): string {
  if (decision === 'REVIEW_REQUIRED') return 'review required';
  if (decision === 'CHANGES_REQUESTED') return 'changes requested';
  if (decision === 'APPROVED') return 'approved';
  return decision || 'none';
}

export function checkSummary(checks: PullRequestSummary['checks']): {
  readonly label: string;
  readonly tone: 'error' | 'info' | 'success' | 'textMuted';
} {
  if (checks === undefined || checks.length === 0) {
    return { label: 'no checks', tone: 'textMuted' };
  }
  const failedStates = new Set([
    'FAILURE',
    'ERROR',
    'CANCELLED',
    'TIMED_OUT',
    'ACTION_REQUIRED',
    'STARTUP_FAILURE',
  ]);
  const passedStates = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
  const failed = checks.filter((check) =>
    failedStates.has(check.state.toUpperCase())
  ).length;
  if (failed > 0) return { label: `${failed} failed`, tone: 'error' };
  const pending = checks.filter(
    (check) => !passedStates.has(check.state.toUpperCase())
  ).length;
  if (pending > 0) return { label: `${pending} pending`, tone: 'info' };
  return { label: `${checks.length} passed`, tone: 'success' };
}

export function rowStatusText(pullRequest: PullRequestSummary): string {
  const comments = `${pullRequest.commentsCount} ${pullRequest.commentsCount === 1 ? 'comment' : 'comments'}`;
  return `  ${reviewDecisionLabel(pullRequest.reviewDecision)} · ${checkSummary(pullRequest.checks).label} · ${comments}${pullRequest.labels.length === 0 ? '' : ` · ${pullRequest.labels.join('  ')}`}`;
}

export function rowMetadataText(pullRequest: PullRequestSummary): string {
  return `  ${pullRequest.repository} #${pullRequest.number}${stackLabel(pullRequest)} opened by ${pullRequest.author} · updated ${relativeAge(pullRequest.updatedAt)} · ${fileSummary(pullRequest.changedFiles)} +${pullRequest.additions} -${pullRequest.deletions}`;
}

export function stackLabel(pullRequest: PullRequestSummary): string {
  return pullRequest.stack === undefined
    ? ''
    : ` · stack ${pullRequest.stack.position}/${pullRequest.stack.size} ·`;
}

export function fileSummary(files: number): string {
  return `${files} ${files === 1 ? 'file' : 'files'}`;
}

export function relativeAge(value: string, now = Date.now()): string {
  const elapsed = Math.max(0, now - Date.parse(value));
  if (!Number.isFinite(elapsed)) return value;
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
