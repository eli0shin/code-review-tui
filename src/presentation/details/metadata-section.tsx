import type { ReactNode } from 'react';
import type { PullRequestDetailSources } from '../../github/types.ts';
import { fileSummary } from '../pull-request-format.ts';
import type { SystemTheme } from '../terminal/theme.ts';
import { DetailSection, Unavailable } from './section.tsx';

export function MetadataSection({
  metadata,
  theme,
}: {
  readonly metadata: PullRequestDetailSources['metadata'] | undefined;
  readonly theme: SystemTheme | undefined;
}) {
  let content: ReactNode;
  if (metadata === undefined) {
    content = <text fg={theme?.textMuted}>Loading metadata…</text>;
  } else if (!metadata.ok) {
    content = <Unavailable label="Pull request metadata" theme={theme} />;
  } else {
    const details = metadata.value;
    content = (
      <>
        <text width="100%" wrapMode="char" fg={theme?.foreground}>
          <strong>{details.title}</strong>
        </text>
        <text fg={theme?.foreground}>
          <span fg={theme?.secondary}>{details.author}</span> · {details.state}
          {details.isDraft ? ' · draft' : ''}
        </text>
        <text fg={theme?.foreground}>
          <span fg={theme?.textMuted}>
            {details.baseRefName} ← {details.headRefName} ·{' '}
            {fileSummary(details.changedFiles)} ·{' '}
          </span>
          <span fg={theme?.success}>+{details.additions}</span>{' '}
          <span fg={theme?.error}>-{details.deletions}</span>
        </text>
        <text fg={theme?.foreground}>
          Labels:{' '}
          <span fg={theme?.warning}>
            {details.labels.length === 0 ? 'none' : details.labels.join(', ')}
          </span>
        </text>
      </>
    );
  }
  return (
    <DetailSection title="Pull request" theme={theme}>
      {content}
    </DetailSection>
  );
}
