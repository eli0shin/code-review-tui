import { TextAttributes, type ScrollBoxRenderable } from '@opentui/core';
import { useEffect } from 'react';
import type { EffectiveKeyBindings } from '../../configuration/index.ts';
import type { PullRequestSummary } from '../../domain/pull-request.ts';
import type { PullRequestDetailSources } from '../../github/types.ts';
import { fallbackSystemTheme, type SystemTheme } from '../terminal/theme.ts';
import { formatBindings, pullRequestActionHints } from '../terminal/keys.ts';
import { herdrFailureMessage } from '../terminal/diagnostics.tsx';
import type {
  QueueNotice,
  HerdrActionFailure,
} from '../review-queue/use-queue-feedback.ts';
import { useMarkdownStyle } from './markdown.tsx';
import { MetadataSection } from './metadata-section.tsx';
import { ReviewersSection } from './reviewers-section.tsx';
import { ChecksSection } from './checks-section.tsx';
import { DescriptionSection } from './description-section.tsx';
import { ConversationSection } from './conversation-section.tsx';

export function PullRequestDetailsModal({
  ref,
  target,
  sources,
  loading,
  notice,
  herdrActionFailure,
  keyBindings,
  theme,
}: {
  readonly ref: React.RefObject<ScrollBoxRenderable | null>;
  readonly target: PullRequestSummary;
  readonly sources: PullRequestDetailSources | undefined;
  readonly loading: boolean;
  readonly notice: QueueNotice | undefined;
  readonly herdrActionFailure: HerdrActionFailure | undefined;
  readonly keyBindings: EffectiveKeyBindings;
  readonly theme: SystemTheme | undefined;
}) {
  const markdownStyle = useMarkdownStyle(theme ?? fallbackSystemTheme);
  useEffect(() => {
    if (notice !== undefined || herdrActionFailure !== undefined) {
      ref.current?.scrollTo(0);
    }
  }, [notice, herdrActionFailure, ref]);
  return (
    <scrollbox
      ref={ref}
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      zIndex={10}
      backgroundColor={theme?.background}
      scrollY
      viewportCulling
      contentOptions={{
        flexDirection: 'column',
        paddingLeft: 2,
        paddingRight: 2,
      }}
    >
      <text fg={theme?.foreground}>
        <strong>Pull request details · </strong>
        <span fg={theme?.info}>
          <strong>{target.repository}</strong>
        </span>
        <strong> #{target.number}</strong>
      </text>
      {notice !== undefined ? (
        <text
          width="100%"
          wrapMode="char"
          fg={notice.tone === 'error' ? theme?.error : theme?.success}
        >
          {notice.message}
        </text>
      ) : null}
      {herdrActionFailure !== undefined ? (
        <text width="100%" wrapMode="char" fg={theme?.error}>
          Could not open {herdrActionFailure.action}:{' '}
          {herdrFailureMessage(herdrActionFailure.failure)}
          {herdrActionFailure.failure.stderr
            ? `\n${herdrActionFailure.failure.stderr}`
            : ''}
        </text>
      ) : null}
      {loading ? <text fg={theme?.info}>Refreshing details…</text> : null}
      <box height={1} />
      <MetadataSection metadata={sources?.metadata} theme={theme} />
      <ReviewersSection
        metadata={sources?.metadata}
        reviews={sources?.reviews}
        theme={theme}
      />
      <ChecksSection checks={sources?.checks} theme={theme} />
      <DescriptionSection
        metadata={sources?.metadata}
        syntaxStyle={markdownStyle}
        theme={theme}
      />
      <ConversationSection
        sources={sources}
        syntaxStyle={markdownStyle}
        theme={theme}
      />
      <text fg={theme?.foreground} attributes={TextAttributes.DIM}>
        {formatBindings(keyBindings.selectPrevious)}/
        {formatBindings(keyBindings.selectNext)} line ·{' '}
        {formatBindings(keyBindings.pagePrevious)}/
        {formatBindings(keyBindings.pageNext)} half-page ·{' '}
        {formatBindings(keyBindings.scrollStart)}/
        {formatBindings(keyBindings.scrollEnd)} start/end ·{' '}
        {pullRequestActionHints(keyBindings)} ·{' '}
        {formatBindings(keyBindings.refresh)} refresh ·{' '}
        {formatBindings(keyBindings.showErrors)} errors ·{' '}
        {formatBindings(keyBindings.quit)} close
      </text>
      <box height={1} />
    </scrollbox>
  );
}
