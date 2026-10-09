import type { PullRequestInlineComment } from '../../domain/pull-request.ts';
import type { GitHubResult } from '../types.ts';
import { loadDetailSource, CompatibilityError } from './json.ts';
import { failure, describeError } from './process.ts';
import {
  parseReviewThreadPage,
  parseReviewThreadCommentPage,
  type ReviewThreadPage,
} from './review-thread-data.ts';

const reviewThreadQuery = `
query($owner:String!,$repository:String!,$number:Int!,$threadsCursor:String) {
  repository(owner:$owner,name:$repository) {
    pullRequest(number:$number) {
      reviewThreads(first:100,after:$threadsCursor) {
        nodes {
          id
          isResolved
          diffSide
          startDiffSide
          comments(first:100) {
            nodes {
              databaseId
              author { login }
              createdAt
              body
              path
              diffHunk
              line
              startLine
              originalLine
              originalStartLine
              outdated
              replyTo { databaseId }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;
const reviewThreadCommentsQuery = `
query($threadId:ID!,$commentsCursor:String) {
  node(id:$threadId) {
    ... on PullRequestReviewThread {
      isResolved
      diffSide
      startDiffSide
      comments(first:100,after:$commentsCursor) {
        nodes {
          databaseId
          author { login }
          createdAt
          body
          path
          diffHunk
          line
          startLine
          originalLine
          originalStartLine
          outdated
          replyTo { databaseId }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

export async function loadInlineComments(
  url: string,
  signal: AbortSignal
): Promise<GitHubResult<readonly PullRequestInlineComment[]>> {
  const targetResult = parsePullRequestUrlResult(url);
  if (!targetResult.ok) {
    return failure({
      kind: 'incompatibleData',
      operation: 'pullRequestReviewThreads',
      url,
      diagnostic: targetResult.diagnostic,
      stderr: '',
    });
  }
  const target = targetResult.value;
  const comments: PullRequestInlineComment[] = [];
  let threadsCursor: string | null = null;
  do {
    const threadPage: GitHubResult<ReviewThreadPage> = await loadDetailSource(
      [
        'api',
        'graphql',
        '--hostname',
        target.hostname,
        '-f',
        `query=${reviewThreadQuery}`,
        '-F',
        `owner=${target.owner}`,
        '-F',
        `repository=${target.repository}`,
        '-F',
        `number=${target.number}`,
        ...(threadsCursor === null
          ? []
          : (['-f', `threadsCursor=${threadsCursor}`] as const)),
      ],
      'pullRequestReviewThreads',
      url,
      signal,
      parseReviewThreadPage
    );
    if (!threadPage.ok) return threadPage;
    comments.push(...threadPage.value.comments);
    threadsCursor = threadPage.value.nextCursor;

    for (const continuation of threadPage.value.continuations) {
      let commentsCursor: string | null = continuation.nextCursor;
      while (commentsCursor !== null) {
        const commentPage: GitHubResult<{
          readonly comments: readonly PullRequestInlineComment[];
          readonly nextCursor: string | null;
        }> = await loadDetailSource(
          [
            'api',
            'graphql',
            '--hostname',
            target.hostname,
            '-f',
            `query=${reviewThreadCommentsQuery}`,
            '-F',
            `threadId=${continuation.threadId}`,
            '-f',
            `commentsCursor=${commentsCursor}`,
          ],
          'pullRequestReviewThreads',
          url,
          signal,
          parseReviewThreadCommentPage
        );
        if (!commentPage.ok) return commentPage;
        comments.push(...commentPage.value.comments);
        commentsCursor = commentPage.value.nextCursor;
      }
    }
  } while (threadsCursor !== null);

  return { ok: true, value: comments };
}

function parsePullRequestUrlResult(url: string):
  | {
      readonly ok: true;
      readonly value: ReturnType<typeof parsePullRequestUrl>;
    }
  | { readonly ok: false; readonly diagnostic: string } {
  try {
    return { ok: true, value: parsePullRequestUrl(url) };
  } catch (error) {
    return { ok: false, diagnostic: describeError(error) };
  }
}

function parsePullRequestUrl(url: string): {
  readonly hostname: string;
  readonly owner: string;
  readonly repository: string;
  readonly number: number;
} {
  const target = new URL(url);
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/.exec(target.pathname);
  if (match === null) {
    throw new CompatibilityError(
      'Pull request URL must contain an owner, repository, and pull request number'
    );
  }
  return {
    hostname: target.hostname,
    owner: decodeURIComponent(match[1]),
    repository: decodeURIComponent(match[2]),
    number: Number(match[3]),
  };
}
