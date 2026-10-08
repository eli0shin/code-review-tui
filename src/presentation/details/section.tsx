import type { ReactNode } from 'react';
import type { SystemTheme } from '../terminal/theme.ts';

export function DetailSection({
  title,
  theme,
  children,
}: {
  readonly title: string;
  readonly theme: SystemTheme | undefined;
  readonly children: ReactNode;
}) {
  return (
    <>
      <text fg={theme?.info}>
        <strong>{title}</strong>
      </text>
      {children}
      <box height={1} />
    </>
  );
}

export function Unavailable({
  label,
  theme,
}: {
  readonly label: string;
  readonly theme: SystemTheme | undefined;
}) {
  return <text fg={theme?.error}>{label} unavailable · show errors</text>;
}
