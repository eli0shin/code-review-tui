import type { ReactNode } from 'react';
import type { PullRequestDetailSources } from '../../github/types.ts';
import { checkStateColor, type SystemTheme } from '../terminal/theme.ts';
import { DetailSection, Unavailable } from './section.tsx';

export function ChecksSection({
  checks,
  theme,
}: {
  readonly checks: PullRequestDetailSources['checks'] | undefined;
  readonly theme: SystemTheme | undefined;
}) {
  let content: ReactNode;
  if (checks === undefined) {
    content = <text fg={theme?.textMuted}>Loading checks…</text>;
  } else if (!checks.ok) {
    content = <Unavailable label="Checks" theme={theme} />;
  } else if (checks.value.length === 0) {
    content = <text fg={theme?.foreground}>None</text>;
  } else {
    content = checks.value.map((check) => (
      <text key={`${check.name}:${check.state}`} fg={theme?.foreground}>
        {check.name} ·{' '}
        <span fg={checkStateColor(check.state, theme)}>{check.state}</span>
      </text>
    ));
  }
  return (
    <DetailSection title="Checks" theme={theme}>
      {content}
    </DetailSection>
  );
}
