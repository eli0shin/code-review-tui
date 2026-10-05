import { describe, expect, test } from 'bun:test';
import { inlineCommentExcerpt } from '../src/domain/inline-comment-context.ts';
import type { InlineCommentSource } from '../src/domain/pull-request.ts';

const source = {
  diffHunk:
    '@@ -10,5 +20,5 @@\n before\n-old call\n+new call\n after\n tail\n end',
  side: 'RIGHT',
  startSide: null,
  line: 21,
  startLine: null,
} satisfies InlineCommentSource;

describe('inline comment source context', () => {
  test('counts old and new coordinates independently and marks the added line', () => {
    const result = inlineCommentExcerpt(source);
    expect(result?.lines).toEqual([
      {
        oldLine: 10,
        newLine: 20,
        kind: 'context',
        content: 'before',
        commented: false,
      },
      {
        oldLine: 11,
        newLine: null,
        kind: 'deletion',
        content: 'old call',
        commented: false,
      },
      {
        oldLine: null,
        newLine: 21,
        kind: 'addition',
        content: 'new call',
        commented: true,
      },
      {
        oldLine: 12,
        newLine: 22,
        kind: 'context',
        content: 'after',
        commented: false,
      },
      {
        oldLine: 13,
        newLine: 23,
        kind: 'context',
        content: 'tail',
        commented: false,
      },
      {
        oldLine: 14,
        newLine: 24,
        kind: 'context',
        content: 'end',
        commented: false,
      },
    ]);
  });
  test('marks deleted ranges using LEFT coordinates', () => {
    const result = inlineCommentExcerpt({
      ...source,
      side: 'LEFT',
      startSide: 'LEFT',
      startLine: 10,
      line: 11,
    });
    expect(
      result?.lines
        ?.filter((line) => line.commented)
        .map((line) => line.content)
    ).toEqual(['before', 'old call']);
  });
  test('handles ranges that start and end on different sides', () => {
    const result = inlineCommentExcerpt({
      ...source,
      startSide: 'LEFT',
      startLine: 11,
    });
    expect(
      result?.lines
        ?.filter((line) => line.commented)
        .map((line) => line.content)
    ).toEqual(['old call', 'new call']);
  });
  test('bounds context to three available lines and accepts a truncated added-file hunk', () => {
    const diffHunk =
      '@@ -0,0 +1,72 @@\n' +
      Array.from({ length: 47 }, (_, index) => `+source ${index + 1}`).join(
        '\n'
      );
    const result = inlineCommentExcerpt({ ...source, diffHunk, line: 47 });
    expect(result?.lines?.map((line) => line.newLine)).toEqual([
      44, 45, 46, 47,
    ]);
    expect(result?.lines?.at(-1)?.commented).toBe(true);
  });
  test('does not borrow context from another hunk or count no-newline markers', () => {
    const result = inlineCommentExcerpt({
      ...source,
      diffHunk:
        '@@ -10 +20 @@\n first\n\\ No newline at end of file\n@@ -30 +40 @@\n second',
      line: 40,
    });
    expect(result?.lines).toEqual([
      {
        oldLine: 30,
        newLine: 40,
        kind: 'context',
        content: 'second',
        commented: true,
      },
    ]);
  });
  test('omits file-level comments and reports missing or malformed saved context', () => {
    expect(inlineCommentExcerpt({ ...source, line: null })).toBeUndefined();
    expect(inlineCommentExcerpt({ ...source, line: 99 })?.diagnostic).toContain(
      'not available'
    );
    expect(
      inlineCommentExcerpt({ ...source, diffHunk: '@@ -10 +20 @@\ninvalid' })
        ?.diagnostic
    ).toContain('could not be parsed');
  });
});
