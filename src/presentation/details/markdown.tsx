import {
  BoxRenderable,
  CodeRenderable,
  TextTableRenderable,
  SyntaxStyle,
  type RGBA,
  type MarkdownOptions,
} from '@opentui/core';
import { useMemo, useEffect } from 'react';
import type { SystemTheme } from '../terminal/theme.ts';

export function MarkdownBody({
  body,
  syntaxStyle,
  theme,
  fallbackFiletype,
  spaceBefore = false,
}: {
  readonly body: string;
  readonly syntaxStyle: SyntaxStyle;
  readonly theme: SystemTheme;
  readonly fallbackFiletype?: string;
  readonly spaceBefore?: boolean;
}) {
  const renderNode = useMemo(
    () =>
      createMarkdownNodeRenderer(
        theme.selectionBackground,
        theme.selectionForeground,
        theme.subtleSurface,
        fallbackFiletype
      ),
    [
      theme.selectionBackground,
      theme.selectionForeground,
      theme.subtleSurface,
      fallbackFiletype,
    ]
  );

  return (
    <markdown
      key={JSON.stringify([body, fallbackFiletype])}
      ref={(markdown) => {
        if (markdown === null) return;
        const blocks = markdown.getChildren();
        let previousWasCode = false;
        for (const block of blocks) {
          const isCode = block.id.endsWith('-background');
          // Share one unshaded gap between code and adjacent Markdown blocks.
          if (isCode || previousWasCode) block.marginTop = 1;
          previousWasCode = isCode;
        }
        markdown.marginTop =
          spaceBefore && !blocks[0]?.id.endsWith('-background') ? 1 : 0;
      }}
      content={body}
      syntaxStyle={syntaxStyle}
      renderNode={renderNode}
      width="100%"
      fg={theme.foreground}
      bg={theme.background}
      conceal
      concealCode={false}
      streaming
      internalBlockMode="top-level"
    />
  );
}

function createMarkdownNodeRenderer(
  selectionBackground: RGBA,
  selectionForeground: RGBA,
  codeBackground: RGBA,
  fallbackFiletype: string | undefined
): NonNullable<MarkdownOptions['renderNode']> {
  return (token, context) => {
    if (token.type !== 'table') {
      const renderable = renderMarkdownNode(token, context);
      if (token.type === 'code' && renderable instanceof CodeRenderable) {
        renderable.bg = codeBackground;
        if (
          (!(typeof token.lang === 'string' && token.lang.trim()) ||
            token.lang === 'suggestion') &&
          fallbackFiletype !== undefined
        ) {
          renderable.filetype = fallbackFiletype;
        }
        const block = new BoxRenderable(renderable.ctx, {
          id: `${renderable.id}-background`,
          width: '100%',
          backgroundColor: codeBackground,
          paddingTop: 1,
          paddingBottom: 1,
          marginBottom: renderable.marginBottom ?? 0,
          flexDirection: 'column',
        });
        renderable.marginTop = 0;
        renderable.marginBottom = 0;
        block.add(renderable);
        return block;
      }
      return renderable;
    }
    const table = context.defaultRender();
    if (!(table instanceof TextTableRenderable)) return table;

    return new TextTableRenderable(table.ctx, {
      id: table.id,
      content: table.content,
      width: '100%',
      columnWidthMode: table.columnWidthMode,
      columnFitter: table.columnFitter,
      wrapMode: table.wrapMode,
      cellPaddingX: table.cellPaddingX,
      cellPaddingY: table.cellPaddingY,
      columnGap: table.columnGap,
      border: table.border,
      outerBorder: table.outerBorder,
      showBorders: table.showBorders,
      borderStyle: table.borderStyle,
      borderColor: table.borderColor,
      selectable: table.selectable,
      selectionBg: selectionBackground,
      selectionFg: selectionForeground,
    });
  };
}

const renderMarkdownNode: NonNullable<MarkdownOptions['renderNode']> = (
  token,
  context
) => {
  if (token.type !== 'code' && token.type !== 'blockquote') return undefined;
  const renderable = context.defaultRender();
  const code =
    renderable instanceof CodeRenderable
      ? renderable
      : renderable instanceof BoxRenderable
        ? renderable
            .getChildren()
            .find((child) => child instanceof CodeRenderable)
        : undefined;
  if (code instanceof CodeRenderable) code.drawUnstyledText = true;
  return renderable;
};

export function useMarkdownStyle(theme: SystemTheme): SyntaxStyle {
  const syntaxStyle = useMemo(
    () =>
      SyntaxStyle.fromStyles({
        default: { fg: theme.foreground },
        keyword: { fg: theme.secondary, bold: true },
        string: { fg: theme.success },
        comment: { fg: theme.textMuted, italic: true },
        number: { fg: theme.warning },
        boolean: { fg: theme.warning },
        constant: { fg: theme.warning },
        function: { fg: theme.secondary },
        type: { fg: theme.secondary },
        constructor: { fg: theme.secondary },
        operator: { fg: theme.secondary },
        variable: { fg: theme.foreground },
        property: { fg: theme.foreground },
        punctuation: { fg: theme.textMuted },
        conceal: { fg: theme.textMuted },
        'markup.heading': { fg: theme.secondary, bold: true },
        'markup.strong': { fg: theme.foreground, bold: true },
        'markup.italic': { fg: theme.foreground, italic: true },
        'markup.strikethrough': { fg: theme.textMuted, dim: true },
        'markup.raw': { fg: theme.warning },
        'markup.list': { fg: theme.info },
        'markup.quote': { fg: theme.textMuted, italic: true },
        'markup.link': { fg: theme.secondary },
        'markup.link.label': { fg: theme.secondary, underline: true },
        'markup.link.url': { fg: theme.textMuted, underline: true },
      }),
    [theme]
  );

  useEffect(
    () => () => {
      syntaxStyle.destroy();
    },
    [syntaxStyle]
  );

  return syntaxStyle;
}
