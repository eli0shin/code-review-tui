import { TextAttributes, type ScrollBoxRenderable } from '@opentui/core';
import type { EffectiveKeyBindings } from '../../configuration/index.ts';
import type { PullRequestSummary } from '../../domain/pull-request.ts';
import type { PullRequestDetailSources } from '../../github/types.ts';
import { fallbackSystemTheme, type SystemTheme } from '../terminal/theme.ts';
import { formatBindings } from '../terminal/keys.ts';
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
  keyBindings,
  theme,
}: {
  readonly ref: React.Ref<ScrollBoxRenderable>;
  readonly target: PullRequestSummary;
  readonly sources: PullRequestDetailSources | undefined;
  readonly loading: boolean;
  readonly keyBindings: EffectiveKeyBindings;
  readonly theme: SystemTheme | undefined;
}) {
  const markdownStyle = useMarkdownStyle(theme ?? fallbackSystemTheme);
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
        {formatBindings(keyBindings.refresh)} refresh ·{' '}
        {formatBindings(keyBindings.showErrors)} errors ·{' '}
        {formatBindings(keyBindings.quit)} close
      </text>
      <box height={1} />
    </scrollbox>
  );
}
