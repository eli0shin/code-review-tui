import type { DiffSide, InlineCommentSource } from './pull-request.ts';

export type SourceContextLine = {
  readonly oldLine: number | null;
  readonly newLine: number | null;
  readonly kind: 'context' | 'addition' | 'deletion';
  readonly content: string;
  readonly commented: boolean;
};

export type SourceExcerpt =
  | {
      readonly lines: readonly SourceContextLine[];
      readonly diagnostic?: never;
    }
  | { readonly lines?: never; readonly diagnostic: string };

/** Use the saved hunk's coordinates, not the current branch's source. */
export function inlineCommentExcerpt(
  source: InlineCommentSource
): SourceExcerpt | undefined {
  const anchorLine = source.line;
  if (anchorLine === null) return undefined;
  const lines: (Omit<SourceContextLine, 'commented'> & { hunk: number })[] = [];
  let oldLine = 0;
  let newLine = 0;
  let hunk = -1;
  for (const raw of source.diffHunk.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header !== null) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      hunk += 1;
      continue;
    }
    if (
      hunk < 0 ||
      line === '' ||
      line.startsWith('\\ No newline at end of file')
    )
      continue;
    if (![' ', '+', '-'].includes(line[0])) {
      return { diagnostic: 'Saved diff context could not be parsed.' };
    }
    const kind =
      line[0] === '+' ? 'addition' : line[0] === '-' ? 'deletion' : 'context';
    lines.push({
      hunk,
      kind,
      content: line.slice(1),
      oldLine: kind === 'addition' ? null : oldLine++,
      newLine: kind === 'deletion' ? null : newLine++,
    });
  }
  const matches = (
    line: (typeof lines)[number],
    side: DiffSide,
    number: number
  ) => (side === 'LEFT' ? line.oldLine : line.newLine) === number;
  const start = lines.findIndex((line) =>
    matches(
      line,
      source.startSide ?? source.side,
      source.startLine ?? anchorLine
    )
  );
  const end = lines.findIndex((line) => matches(line, source.side, anchorLine));
  if (start < 0 || end < start || lines[start].hunk !== lines[end].hunk) {
    return {
      diagnostic: 'The commented range is not available in the saved diff.',
    };
  }
  return {
    lines: lines
      .map((line, index) => ({
        ...line,
        commented: index >= start && index <= end,
      }))
      .slice(Math.max(0, start - 3), end + 4)
      .filter((line) => line.hunk === lines[start].hunk)
      .map((line) => ({
        oldLine: line.oldLine,
        newLine: line.newLine,
        kind: line.kind,
        content: line.content,
        commented: line.commented,
      })),
  };
}
