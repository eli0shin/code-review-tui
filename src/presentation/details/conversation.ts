import { extToFiletype } from '@opentui/core';
import type { InlineCommentSource } from '../../domain/pull-request.ts';
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

export type ConversationEntry = {
  readonly key: string;
  readonly kind: 'Issue comment' | 'Submitted review' | 'Inline review comment';
  readonly author: string;
  readonly timestamp: string;
  readonly state?: string;
  readonly context?: string;
  readonly codeFiletype?: string;
  readonly source?: InlineCommentSource;
  readonly body: string;
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
    entries.push(
      ...sources.inlineComments.value.map((comment) => ({
        key: `inline:${comment.id}`,
        timestamp: comment.createdAt,
        kind: 'Inline review comment' as const,
        author: comment.author,
        context: inlineCommentContext(comment),
        codeFiletype: extToFiletype(comment.path.split('.').at(-1) ?? ''),
        source: comment.inReplyToId === null ? comment.source : undefined,
        body: comment.body,
      }))
    );
  }
  return entries.sort((left, right) =>
    left.timestamp === right.timestamp
      ? left.key.localeCompare(right.key)
      : left.timestamp.localeCompare(right.timestamp)
  );
}

function inlineCommentContext(comment: {
  readonly path: string;
  readonly line: number | null;
  readonly startLine: number | null;
  readonly inReplyToId: string | null;
  readonly resolved: boolean;
  readonly outdated: boolean;
}): string {
  const location =
    comment.line === null
      ? comment.path
      : comment.startLine !== null && comment.startLine !== comment.line
        ? `${comment.path}:${comment.startLine}-${comment.line}`
        : `${comment.path}:${comment.line}`;
  return `${location} · ${comment.inReplyToId === null ? 'thread start' : `reply to ${comment.inReplyToId}`} · ${comment.resolved ? 'resolved' : 'unresolved'} · ${comment.outdated ? 'outdated' : 'current'}`;
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
