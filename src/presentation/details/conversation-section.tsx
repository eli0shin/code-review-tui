import type { SyntaxStyle } from '@opentui/core';
import type { PullRequestDetailSources } from '../../github/types.ts';
import {
  fallbackSystemTheme,
  reviewStateColor,
  type SystemTheme,
} from '../terminal/theme.ts';
import {
  collectConversation,
  hideVercelMetadata,
  type ConversationEntry,
} from './conversation.ts';
import { InlineCommentSourcePanel } from './inline-source.tsx';
import { MarkdownBody } from './markdown.tsx';
import { DetailSection, Unavailable } from './section.tsx';

export function ConversationSection({
  sources,
  syntaxStyle,
  theme,
}: {
  readonly sources: PullRequestDetailSources | undefined;
  readonly syntaxStyle: SyntaxStyle;
  readonly theme: SystemTheme | undefined;
}) {
  const reviews = sources?.reviews;
  const issueComments = sources?.issueComments;
  const inlineComments = sources?.inlineComments;
  const conversation = collectConversation(sources);
  return (
    <DetailSection title="Conversation" theme={theme}>
      {reviews === undefined ||
      issueComments === undefined ||
      inlineComments === undefined ? (
        <text fg={theme?.textMuted}>Loading conversation…</text>
      ) : null}
      {issueComments !== undefined && !issueComments.ok ? (
        <Unavailable label="Issue comments" theme={theme} />
      ) : null}
      {reviews !== undefined && !reviews.ok ? (
        <Unavailable label="Submitted reviews" theme={theme} />
      ) : null}
      {inlineComments !== undefined && !inlineComments.ok ? (
        <Unavailable label="Inline review comments" theme={theme} />
      ) : null}
      {conversation.map((entry) => (
        <ConversationItem
          key={entry.key}
          entry={entry}
          syntaxStyle={syntaxStyle}
          theme={theme}
        />
      ))}
      {conversation.length === 0 &&
      issueComments?.ok &&
      reviews?.ok &&
      inlineComments?.ok ? (
        <text fg={theme?.foreground}>None</text>
      ) : null}
    </DetailSection>
  );
}

function ConversationItem({
  entry,
  syntaxStyle,
  theme,
}: {
  readonly entry: ConversationEntry;
  readonly syntaxStyle: SyntaxStyle;
  readonly theme: SystemTheme | undefined;
}) {
  const resolvedTheme = theme ?? fallbackSystemTheme;
  const body =
    entry.author === 'vercel' || entry.author === 'vercel[bot]'
      ? hideVercelMetadata(entry.body)
      : entry.body;
  return (
    <box flexDirection="column" marginTop={1}>
      <box
        height={1}
        flexShrink={0}
        border={['top']}
        borderColor={theme?.textMuted}
      />
      <text fg={theme?.secondary}>
        <strong>{entry.kind} · </strong>
        <span fg={theme?.secondary}>
          <strong>{entry.author}</strong>
        </span>
        <span fg={theme?.textMuted}> · {entry.timestamp}</span>
        {entry.state === undefined ? null : (
          <span fg={reviewStateColor(entry.state, theme)}>
            <strong> · {entry.state}</strong>
          </span>
        )}
      </text>
      {entry.context === undefined ? null : (
        <text fg={theme?.textMuted}>{entry.context}</text>
      )}
      {entry.source === undefined ? null : (
        <InlineCommentSourcePanel
          source={entry.source}
          theme={resolvedTheme}
          filetype={entry.codeFiletype}
          syntaxStyle={syntaxStyle}
        />
      )}
      <MarkdownBody
        spaceBefore
        body={body}
        syntaxStyle={syntaxStyle}
        theme={resolvedTheme}
        fallbackFiletype={entry.codeFiletype}
      />
    </box>
  );
}
