import type { ReviewDecision } from '../domain/pull-request.ts';
import type { GitHub, GitHubResult } from './types.ts';
import { createReviewQueueLoader } from './cli/review-queue.ts';
import { loadPullRequestDetails } from './cli/pull-request-details.ts';
import { runGh } from './cli/process.ts';

export function createGitHubCliAdapter(search: readonly string[]): GitHub {
  return {
    loadReviewQueue: createReviewQueueLoader(search),
    loadPullRequestDetails,
    async openPullRequestInBrowser(url, signal) {
      return runGh(
        ['pr', 'view', url, '--web'],
        '',
        'openPullRequestInBrowser',
        url,
        signal
      ).then((result): GitHubResult<void> =>
        result.ok ? { ok: true, value: undefined } : result
      );
    },

    async submitReview(submission, signal) {
      return runGh(
        [
          'pr',
          'review',
          submission.url,
          decisionFlag(submission.decision),
          '--body-file',
          '-',
        ],
        submission.message,
        'reviewSubmission',
        submission.url,
        signal
      ).then((result): GitHubResult<void> =>
        result.ok ? { ok: true, value: undefined } : result
      );
    },
  };
}

function decisionFlag(decision: ReviewDecision): string {
  switch (decision) {
    case 'comment':
      return '--comment';
    case 'approve':
      return '--approve';
    case 'requestChanges':
      return '--request-changes';
  }
}
