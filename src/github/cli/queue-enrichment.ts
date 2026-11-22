import type { PullRequestSummary } from '../../domain/pull-request.ts';
import { reviewSummaryDecision } from '../../domain/reviews.ts';
import { record, integer, string } from './json.ts';
import { parseChecks, parseReviews } from './pull-request-data.ts';

/** Adds a search row's size, review decision, and checks to its summary. */
export function addSummaryStats(
  pullRequest: PullRequestSummary,
  value: unknown,
  path = '$'
): PullRequestSummary {
  const stats = record(value, path);
  return {
    ...pullRequest,
    additions: integer(stats.additions, `${path}.additions`),
    deletions: integer(stats.deletions, `${path}.deletions`),
    changedFiles: integer(stats.changedFiles, `${path}.changedFiles`),
    reviewDecision: reviewSummaryDecision(
      parseReviews(stats),
      string(stats.reviewDecision, `${path}.reviewDecision`)
    ),
    checks: parseChecks(stats),
  };
}
