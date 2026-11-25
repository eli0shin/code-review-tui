import type { EffectiveKeyBindings } from '../../configuration/index.ts';
import type { GitHubFailure } from '../../github/types.ts';
import { failureMessage } from '../terminal/diagnostics.tsx';
import { formatBindings } from '../terminal/keys.ts';
import type { SystemTheme } from '../terminal/theme.ts';
import type { RepositoryFilterRow } from './use-repository-filter.ts';

// Title, a blank line, the status line, and the key hints.
const chromeHeight = 4;

export function RepositoryFilterModal({
  rows,
  cursorPosition,
  loading,
  failure,
  keyBindings,
  terminal,
  theme,
}: {
  readonly rows: readonly RepositoryFilterRow[];
  readonly cursorPosition: number;
  readonly loading: boolean;
  readonly failure: GitHubFailure | null;
  readonly keyBindings: EffectiveKeyBindings;
  readonly terminal: { readonly width: number; readonly height: number };
  readonly theme: SystemTheme | undefined;
}) {
  const countWidth = Math.max(
    0,
    ...rows.map((row) =>
      row.kind === 'repository' ? String(row.count).length : 0
    )
  );
  const nameWidth = Math.max(
    'All repositories'.length,
    ...rows.map((row) =>
      row.kind === 'repository' ? row.nameWithOwner.length + 4 : 0
    )
  );
  const movement = `${keyBindings.selectNext[0]}/${keyBindings.selectPrevious[0]}`;
  const hints = `${movement} move · space check · enter only this · ${formatBindings(keyBindings.quit)} close`;
  // Border and padding take four columns.
  const width = Math.max(
    1,
    Math.min(
      Math.max(nameWidth + countWidth + 3, hints.length) + 4,
      terminal.width - 2
    )
  );
  const visibleRows = Math.max(
    1,
    Math.min(rows.length, terminal.height - chromeHeight - 4)
  );
  const height = Math.max(
    1,
    Math.min(visibleRows + chromeHeight + 2, terminal.height)
  );
  // Keep the cursor's row in view without scrolling past the last row.
  const firstRow = Math.min(
    Math.max(cursorPosition - visibleRows + 1, 0),
    rows.length - visibleRows
  );
  const status = loading
    ? 'Loading repositories…'
    : failure !== null
      ? `Repositories unavailable: ${failureMessage(failure)}`
      : ' ';
  return (
    <box
      position="absolute"
      left={Math.max(0, Math.floor((terminal.width - width) / 2))}
      top={Math.max(0, Math.floor((terminal.height - height) / 2))}
      width={width}
      height={height}
      zIndex={20}
      border
      borderColor={theme?.foreground}
      backgroundColor={theme?.background}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="column"
    >
      <text fg={theme?.foreground} marginBottom={1} flexShrink={0}>
        <strong>Filter repositories</strong>
      </text>
      {rows.slice(firstRow, firstRow + visibleRows).map((row, index) => {
        const highlighted = firstRow + index === cursorPosition;
        const pointer = highlighted ? '›' : ' ';
        const text =
          row.kind === 'all'
            ? `${pointer} All repositories`
            : `${pointer} [${row.checked ? 'x' : ' '}] ${row.nameWithOwner}`;
        const count =
          row.kind === 'repository'
            ? String(row.count).padStart(countWidth)
            : '';
        return (
          <box
            key={row.kind === 'all' ? '' : row.nameWithOwner}
            flexDirection="row"
            justifyContent="space-between"
            flexShrink={0}
            backgroundColor={highlighted ? theme?.subtleSurface : undefined}
          >
            <text fg={theme?.foreground} wrapMode="none">
              {text}
            </text>
            <text fg={theme?.textMuted}>{count}</text>
          </box>
        );
      })}
      <text
        fg={failure === null ? theme?.textMuted : theme?.error}
        flexShrink={0}
        wrapMode="none"
      >
        {status}
      </text>
      <text fg={theme?.textMuted} flexShrink={0} wrapMode="none">
        {hints}
      </text>
    </box>
  );
}
