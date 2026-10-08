import type { PullRequestDetailSources } from '../types.ts';
import { loadDetailSource } from './json.ts';
import {
  parsePullRequestDetails,
  parseReviews,
  parseChecks,
  parseIssueComments,
} from './pull-request-data.ts';
import { loadInlineComments } from './review-threads.ts';

const detailFields =
  'number,title,body,author,state,isDraft,url,createdAt,updatedAt,baseRefName,headRefName,additions,deletions,changedFiles,labels,reviewDecision,reviewRequests';

export async function loadPullRequestDetails(
  url: string,
  signal: AbortSignal
): Promise<PullRequestDetailSources> {
  const [metadata, reviews, checks, issueComments, inlineComments] =
    await Promise.all([
      loadDetailSource(
        ['pr', 'view', url, '--json', detailFields],
        'pullRequestMetadata',
        url,
        signal,
        parsePullRequestDetails
      ),
      loadDetailSource(
        ['pr', 'view', url, '--json', 'reviews'],
        'pullRequestReviews',
        url,
        signal,
        parseReviews
      ),
      loadDetailSource(
        ['pr', 'view', url, '--json', 'statusCheckRollup'],
        'pullRequestChecks',
        url,
        signal,
        parseChecks
      ),
      loadDetailSource(
        ['pr', 'view', url, '--json', 'comments'],
        'pullRequestIssueComments',
        url,
        signal,
        parseIssueComments
      ),
      loadInlineComments(url, signal),
    ]);
  return { metadata, reviews, checks, issueComments, inlineComments };
}
