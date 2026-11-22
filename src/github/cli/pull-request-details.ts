import type {
  GitHubOperation,
  GitHubResult,
  PullRequestDetailSources,
} from '../types.ts';
import { readGhp } from './ghp.ts';
import { array, record, validateJson } from './json.ts';
import {
  parsePullRequestDetails,
  parseReviews,
  parseChecks,
  parseIssueComments,
} from './pull-request-data.ts';
import { parseReviewThreadPage } from './review-thread-data.ts';

/**
 * Reads everything the details modal shows with one ghp read, then parses
 * each source on its own, so one incompatible source does not hide the rest.
 */
export async function loadPullRequestDetails(
  url: string,
  signal: AbortSignal,
  options: { readonly fresh?: boolean } = {}
): Promise<PullRequestDetailSources> {
  const read = await readGhp(
    ['pr', 'details', url, ...(options.fresh ? ['--max-age', '0'] : [])],
    'pullRequestMetadata',
    url,
    signal
  );
  function source<Value>(
    operation: GitHubOperation,
    select: (details: Record<string, unknown>) => unknown,
    parse: (value: unknown) => Value
  ): GitHubResult<Value> {
    if (!read.ok) return { ok: false, failure: { ...read.failure, operation } };
    return validateJson(
      read.value.value,
      read.value.stderr,
      operation,
      (value) => parse(select(record(value, '$'))),
      url
    );
  }
  return {
    metadata: source(
      'pullRequestMetadata',
      (details) => details.metadata,
      parsePullRequestDetails
    ),
    reviews: source(
      'pullRequestReviews',
      (details) => ({ reviews: details.reviews }),
      parseReviews
    ),
    checks: source(
      'pullRequestChecks',
      (details) => ({ statusCheckRollup: details.statusCheckRollup }),
      parseChecks
    ),
    issueComments: source(
      'pullRequestIssueComments',
      (details) => ({ comments: details.comments }),
      parseIssueComments
    ),
    inlineComments: source(
      'pullRequestReviewThreads',
      (details) => reviewThreadPage(details.reviewThreads),
      (value) => parseReviewThreadPage(value).comments
    ),
  };
}

const lastPage = { hasNextPage: false, endCursor: null };

// ghp returns every review thread with all of its comments. Present them as
// the single complete page the review-thread parser reads.
function reviewThreadPage(value: unknown): unknown {
  return {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: array(value, '$.reviewThreads').map((thread, index) => {
              const threadValue = record(thread, `$.reviewThreads[${index}]`);
              return {
                ...threadValue,
                comments: { nodes: threadValue.comments, pageInfo: lastPage },
              };
            }),
            pageInfo: lastPage,
          },
        },
      },
    },
  };
}
