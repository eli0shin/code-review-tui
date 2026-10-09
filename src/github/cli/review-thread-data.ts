import type {
  DiffSide,
  PullRequestInlineComment,
} from '../../domain/pull-request.ts';
import {
  record,
  array,
  string,
  boolean,
  integer,
  nullableRecord,
  nullableInteger,
  diffSide,
} from './json.ts';

export type ReviewThreadPage = {
  readonly comments: readonly PullRequestInlineComment[];
  readonly continuations: readonly {
    readonly threadId: string;
    readonly nextCursor: string;
  }[];
  readonly nextCursor: string | null;
};

export function parseReviewThreadPage(value: unknown): ReviewThreadPage {
  const data = record(record(value, '$').data, '$.data');
  const repository = record(data.repository, '$.data.repository');
  const pullRequest = record(
    repository.pullRequest,
    '$.data.repository.pullRequest'
  );
  const threadsPath = '$.data.repository.pullRequest.reviewThreads';
  const threads = record(pullRequest.reviewThreads, threadsPath);
  const comments: PullRequestInlineComment[] = [];
  const continuations: { threadId: string; nextCursor: string }[] = [];
  array(threads.nodes, `${threadsPath}.nodes`).forEach(
    (threadValue, threadIndex) => {
      const threadPath = `${threadsPath}.nodes[${threadIndex}]`;
      const thread = record(threadValue, threadPath);
      const resolved = boolean(thread.isResolved, `${threadPath}.isResolved`);
      const threadComments = record(thread.comments, `${threadPath}.comments`);
      comments.push(
        ...parseInlineCommentNodes(
          threadComments.nodes,
          `${threadPath}.comments.nodes`,
          resolved,
          diffSide(thread.diffSide, `${threadPath}.diffSide`),
          thread.startDiffSide === null
            ? null
            : diffSide(thread.startDiffSide, `${threadPath}.startDiffSide`)
        )
      );
      const nextCommentsCursor = parseNextCursor(
        threadComments.pageInfo,
        `${threadPath}.comments.pageInfo`
      );
      if (nextCommentsCursor !== null) {
        continuations.push({
          threadId: string(thread.id, `${threadPath}.id`),
          nextCursor: nextCommentsCursor,
        });
      }
    }
  );
  return {
    comments,
    continuations,
    nextCursor: parseNextCursor(threads.pageInfo, `${threadsPath}.pageInfo`),
  };
}

export function parseReviewThreadCommentPage(value: unknown): {
  readonly comments: readonly PullRequestInlineComment[];
  readonly nextCursor: string | null;
} {
  const data = record(record(value, '$').data, '$.data');
  const node = record(data.node, '$.data.node');
  const resolved = boolean(node.isResolved, '$.data.node.isResolved');
  const comments = record(node.comments, '$.data.node.comments');
  return {
    comments: parseInlineCommentNodes(
      comments.nodes,
      '$.data.node.comments.nodes',
      resolved,
      diffSide(node.diffSide, '$.data.node.diffSide'),
      node.startDiffSide === null
        ? null
        : diffSide(node.startDiffSide, '$.data.node.startDiffSide')
    ),
    nextCursor: parseNextCursor(
      comments.pageInfo,
      '$.data.node.comments.pageInfo'
    ),
  };
}

function parseInlineCommentNodes(
  value: unknown,
  path: string,
  resolved: boolean,
  side: DiffSide,
  startSide: DiffSide | null
): readonly PullRequestInlineComment[] {
  return array(value, path).map((commentValue, index) => {
    const commentPath = `${path}[${index}]`;
    const comment = record(commentValue, commentPath);
    const author = nullableRecord(comment.author, `${commentPath}.author`);
    const replyTo = nullableRecord(comment.replyTo, `${commentPath}.replyTo`);
    const originalLine = nullableInteger(
      comment.originalLine,
      `${commentPath}.originalLine`
    );
    const originalStartLine = nullableInteger(
      comment.originalStartLine,
      `${commentPath}.originalStartLine`
    );
    const currentLine = nullableInteger(comment.line, `${commentPath}.line`);
    const currentStartLine = nullableInteger(
      comment.startLine,
      `${commentPath}.startLine`
    );
    return {
      id: String(integer(comment.databaseId, `${commentPath}.databaseId`)),
      author:
        author === null
          ? 'ghost'
          : string(author.login, `${commentPath}.author.login`),
      createdAt: string(comment.createdAt, `${commentPath}.createdAt`),
      body: string(comment.body, `${commentPath}.body`),
      path: string(comment.path, `${commentPath}.path`),
      line: currentLine ?? originalLine,
      startLine: currentStartLine ?? originalStartLine,
      inReplyToId:
        replyTo === null
          ? null
          : String(
              integer(replyTo.databaseId, `${commentPath}.replyTo.databaseId`)
            ),
      resolved,
      outdated: boolean(comment.outdated, `${commentPath}.outdated`),
      source: {
        diffHunk: string(comment.diffHunk, `${commentPath}.diffHunk`),
        side,
        startSide,
        // The saved diff hunk uses the original comment coordinates, even after edits shift the current line.
        line: originalLine ?? currentLine,
        startLine: originalLine === null ? currentStartLine : originalStartLine,
      },
    };
  });
}

function parseNextCursor(value: unknown, path: string): string | null {
  const pageInfo = record(value, path);
  return boolean(pageInfo.hasNextPage, `${path}.hasNextPage`)
    ? string(pageInfo.endCursor, `${path}.endCursor`)
    : null;
}
