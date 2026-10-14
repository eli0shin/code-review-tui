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
  type ConversationComment,
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

// Resolved review threads stay readable but recede behind open discussion.
const resolvedThreadOpacity = 0.5;

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
  return (
    <box flexDirection="column" marginTop={1}>
      <box
        height={1}
        flexShrink={0}
        border={['top']}
        borderColor={theme?.textMuted}
      />
      {entry.kind === 'Review thread' ? (
        <box
          flexDirection="column"
          opacity={entry.resolved ? resolvedThreadOpacity : 1}
        >
          <text fg={theme?.secondary}>
            <strong>{entry.kind}</strong>
          </text>
          <text fg={theme?.textMuted}>{entry.context}</text>
          {entry.source === undefined ? null : (
            <InlineCommentSourcePanel
              source={entry.source}
              theme={resolvedTheme}
              filetype={entry.codeFiletype}
              syntaxStyle={syntaxStyle}
            />
          )}
          <box
            flexDirection="column"
            marginTop={1}
            paddingLeft={1}
            border={['left']}
            borderColor={theme?.textMuted}
          >
            {entry.comments.map((comment, index) => (
              <box
                key={comment.key}
                flexDirection="column"
                marginTop={index === 0 ? 0 : 1}
              >
                <text>
                  <span fg={theme?.secondary}>
                    <strong>{comment.author}</strong>
                  </span>
                  <span fg={theme?.textMuted}> · {comment.timestamp}</span>
                </text>
                <MarkdownBody
                  body={conversationBody(comment)}
                  syntaxStyle={syntaxStyle}
                  theme={resolvedTheme}
                  fallbackFiletype={entry.codeFiletype}
                />
              </box>
            ))}
          </box>
        </box>
      ) : (
        <>
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
          <MarkdownBody
            spaceBefore
            body={conversationBody(entry)}
            syntaxStyle={syntaxStyle}
            theme={resolvedTheme}
          />
        </>
      )}
    </box>
  );
}

function conversationBody(comment: ConversationComment): string {
  return comment.author === 'vercel' || comment.author === 'vercel[bot]'
    ? hideVercelMetadata(comment.body)
    : comment.body;
}
