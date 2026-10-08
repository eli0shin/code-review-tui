import type { SyntaxStyle, LineColorConfig, LineSign } from '@opentui/core';
import { inlineCommentExcerpt } from '../../domain/inline-comment-context.ts';
import type { InlineCommentSource } from '../../domain/pull-request.ts';
import type { SystemTheme } from '../terminal/theme.ts';

export function InlineCommentSourcePanel({
  source,
  theme,
  filetype,
  syntaxStyle,
}: {
  readonly source: InlineCommentSource;
  readonly theme: SystemTheme;
  readonly filetype: string | undefined;
  readonly syntaxStyle: SyntaxStyle;
}) {
  const excerpt = inlineCommentExcerpt(source);
  if (excerpt === undefined) return null;
  if (excerpt.diagnostic !== undefined) {
    return (
      <text marginTop={1} fg={theme.warning}>
        Source context unavailable: {excerpt.diagnostic}
      </text>
    );
  }
  const lineColors = new Map<number, LineColorConfig>();
  const lineSigns = new Map<number, LineSign>();
  const lineNumbers = new Map<number, number>();
  excerpt.lines.forEach((line, index) => {
    const number =
      line.kind === 'deletion'
        ? line.oldLine
        : line.kind === 'addition'
          ? line.newLine
          : source.side === 'LEFT'
            ? line.oldLine
            : line.newLine;
    if (number !== null) lineNumbers.set(index, number);
    lineSigns.set(index, {
      before: line.commented ? '> ' : '  ',
      beforeColor: theme.warning,
      after:
        line.kind === 'addition'
          ? ' +'
          : line.kind === 'deletion'
            ? ' -'
            : '  ',
      afterColor: line.kind === 'addition' ? theme.success : theme.error,
    });
    if (line.commented)
      lineColors.set(index, {
        gutter: theme.subtleSurface,
        content: theme.subtleSurface,
      });
  });
  return (
    <box flexDirection="column" marginTop={1}>
      <line-number
        key={JSON.stringify([source, filetype])}
        width="100%"
        fg={theme.textMuted}
        bg={theme.background}
        ref={(gutter) => {
          if (gutter === null) return;
          gutter.setLineColors(lineColors);
          gutter.setLineSigns(lineSigns);
          gutter.setLineNumbers(lineNumbers);
        }}
      >
        <code
          content={excerpt.lines.map((line) => line.content).join('\n')}
          filetype={filetype}
          syntaxStyle={syntaxStyle}
          fg={theme.foreground}
          wrapMode="char"
          drawUnstyledText
        />
      </line-number>
    </box>
  );
}
