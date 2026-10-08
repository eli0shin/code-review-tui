import type {
  PullRequestSummary,
  ReviewQueue,
} from '../../domain/pull-request.ts';
import type { GitHubResult } from '../types.ts';
import { runGh } from './process.ts';
import { parseOutput, record, integer, string } from './json.ts';
import { parseChecks } from './pull-request-data.ts';

const queueStatsFields =
  'additions,deletions,changedFiles,reviewDecision,statusCheckRollup';
const queueEnrichmentConcurrency = 8;

export async function enrichReviewQueue(
  queue: ReviewQueue,
  signal: AbortSignal
): Promise<GitHubResult<ReviewQueue>> {
  const enriched: PullRequestSummary[] = [];
  for (
    let offset = 0;
    offset < queue.length;
    offset += queueEnrichmentConcurrency
  ) {
    const batch = queue.slice(offset, offset + queueEnrichmentConcurrency);
    const results = await Promise.all(batch.map(loadSummaryStats));
    const failureResult = results.find((result) => !result.ok);
    if (failureResult !== undefined) return failureResult;
    enriched.push(
      ...results.flatMap((result) => (result.ok ? [result.value] : []))
    );
  }
  return { ok: true, value: enriched };

  async function loadSummaryStats(
    pullRequest: PullRequestSummary
  ): Promise<GitHubResult<PullRequestSummary>> {
    const processResult = await runGh(
      ['pr', 'view', pullRequest.url, '--json', queueStatsFields],
      '',
      'reviewQueue',
      undefined,
      signal
    );
    if (!processResult.ok) return processResult;
    return parseOutput(processResult.value, 'reviewQueue', (value) =>
      addSummaryStats(pullRequest, value)
    );
  }
}

function addSummaryStats(
  pullRequest: PullRequestSummary,
  value: unknown
): PullRequestSummary {
  const stats = record(value, '$');
  return {
    ...pullRequest,
    additions: integer(stats.additions, '$.additions'),
    deletions: integer(stats.deletions, '$.deletions'),
    changedFiles: integer(stats.changedFiles, '$.changedFiles'),
    reviewDecision: string(stats.reviewDecision, '$.reviewDecision'),
    checks: parseChecks(stats),
  };
}
