import type { SyntaxStyle } from '@opentui/core';
import type { ReactNode } from 'react';
import type { PullRequestDetailSources } from '../../github/types.ts';
import { fallbackSystemTheme, type SystemTheme } from '../terminal/theme.ts';
import { MarkdownBody } from './markdown.tsx';
import { DetailSection, Unavailable } from './section.tsx';

export function DescriptionSection({
  metadata,
  syntaxStyle,
  theme,
}: {
  readonly metadata: PullRequestDetailSources['metadata'] | undefined;
  readonly syntaxStyle: SyntaxStyle;
  readonly theme: SystemTheme | undefined;
}) {
  let content: ReactNode;
  if (metadata === undefined) {
    content = <text fg={theme?.textMuted}>Loading description…</text>;
  } else if (!metadata.ok) {
    content = <Unavailable label="Description" theme={theme} />;
  } else {
    content = (
      <MarkdownBody
        body={metadata.value.body || 'No description provided.'}
        syntaxStyle={syntaxStyle}
        theme={theme ?? fallbackSystemTheme}
      />
    );
  }
  return (
    <DetailSection title="Description" theme={theme}>
      {content}
    </DetailSection>
  );
}
