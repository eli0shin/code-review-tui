import { extToFiletype } from '@opentui/core';
import type {
  InlineCommentSource,
  PullRequestInlineComment,
} from '../../domain/pull-request.ts';
import type {
  GitHubFailure,
  PullRequestDetailSources,
} from '../../github/types.ts';

export function hideVercelMetadata(body: string): string {
  return body.replace(
    /^\[vc\]:[ \t]*#[A-Za-z0-9+/=_-]+:[ \t]*(?:\r?\n[ \t]*)?([A-Za-z0-9+/=]+)[ \t]*(?=\r?\n|$)/gm,
    (reference, payload: string) => {
      try {
        const metadata: unknown = JSON.parse(
          Buffer.from(payload, 'base64').toString('utf8')
        );
        return metadata !== null &&
          typeof metadata === 'object' &&
          'projects' in metadata &&
          Array.isArray(metadata.projects)
          ? ''
          : reference;
      } catch {
        return reference;
      }
    }
  );
}

export type ConversationComment = {
  readonly key: string;
  readonly author: string;
  readonly timestamp: string;
  readonly body: string;
};

export type ConversationEntry =
  | (ConversationComment & {
      readonly kind: 'Issue comment' | 'Submitted review';
      readonly state?: string;
    })
  | {
      readonly kind: 'Review thread';
      readonly key: string;
      readonly timestamp: string;
      readonly context: string;
      readonly resolved: boolean;
      readonly codeFiletype?: string;
      readonly source?: InlineCommentSource;
      readonly comments: readonly ConversationComment[];
    };

export function collectConversation(
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
    entries.push(...collectReviewThreads(sources.inlineComments.value));
  }
  return entries.sort((left, right) =>
    left.timestamp === right.timestamp
      ? left.key.localeCompare(right.key)
      : left.timestamp.localeCompare(right.timestamp)
  );
}

// GitHub returns each review thread's comments in order, so the first comment
// anchors the thread's place in the conversation and its file context.
function collectReviewThreads(
  comments: readonly PullRequestInlineComment[]
): readonly ConversationEntry[] {
  const threads = Map.groupBy(comments, (comment) => comment.threadId);
  return [...threads].flatMap(([threadId, thread]) => {
    const first = thread.at(0);
    if (first === undefined) return [];
    return [
      {
        kind: 'Review thread' as const,
        key: `thread:${threadId}`,
        timestamp: first.createdAt,
        context: reviewThreadContext(first),
        resolved: first.resolved,
        codeFiletype: extToFiletype(first.path.split('.').at(-1) ?? ''),
        source: first.source,
        comments: thread.map((comment) => ({
          key: `inline:${comment.id}`,
          author: comment.author,
          timestamp: comment.createdAt,
          body: comment.body,
        })),
      },
    ];
  });
}

function reviewThreadContext(comment: PullRequestInlineComment): string {
  const location =
    comment.line === null
      ? comment.path
      : comment.startLine !== null && comment.startLine !== comment.line
        ? `${comment.path}:${comment.startLine}-${comment.line}`
        : `${comment.path}:${comment.line}`;
  return `${location} · ${comment.resolved ? 'resolved' : 'unresolved'} · ${comment.outdated ? 'outdated' : 'current'}`;
}

export function collectDetailFailures(
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
