import { TextAttributes } from '@opentui/core';
import type {
  EffectiveKeyBindings,
  QueueAction,
} from '../../configuration/index.ts';
import type { PullRequestList } from '../../github/types.ts';
import type { SystemTheme } from '../terminal/theme.ts';
import { formatBindings } from '../terminal/keys.ts';

export function HelpOverlay({
  list,
  keyBindings,
  theme,
}: {
  readonly list: PullRequestList;
  readonly keyBindings: EffectiveKeyBindings;
  readonly theme: SystemTheme | undefined;
}) {
  const line = (action: QueueAction, label: string) => (
    <>
      <span fg={theme?.secondary}>{formatBindings(keyBindings[action])}</span>
      {'  '}
      {label}
    </>
  );
  return (
    <box
      position="absolute"
      left="37.5%"
      top="15%"
      width="25%"
      height={list === 'reviewQueue' ? 20 : 19}
      zIndex={10}
      border
      borderColor={theme?.foreground}
      backgroundColor={theme?.background}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="column"
    >
      <text fg={theme?.info} marginBottom={1} flexShrink={0}>
        <strong>Review Queue keys</strong>
      </text>
      <text fg={theme?.foreground}>{line('selectPrevious', 'previous')}</text>
      <text fg={theme?.foreground}>{line('selectNext', 'next')}</text>
      <text fg={theme?.foreground}>{line('openDetails', 'open details')}</text>
      <text fg={theme?.foreground}>
        {line('openInBrowser', 'open in browser')}
      </text>
      <text fg={theme?.foreground}>{line('openDiff', 'open diff')}</text>
      <text fg={theme?.foreground}>
        {line('runReviewCommand', 'run Review Command')}
      </text>
      <text fg={theme?.foreground}>
        {line('composeReviewSubmission', 'compose Review Submission')}
      </text>
      <text fg={theme?.foreground}>
        {line('togglePullRequestList', 'switch Review Queue / My PRs')}
      </text>
      <text fg={theme?.foreground}>
        {line('toggleRepositoryScope', 'toggle launch repository scope')}
      </text>
      {list === 'reviewQueue' ? (
        <text fg={theme?.foreground}>
          {line('editReviewQueueSearch', 'edit Review Queue query')}
        </text>
      ) : null}
      <text fg={theme?.foreground}>
        {line('previousPullRequestPage', 'previous PR page')}
      </text>
      <text fg={theme?.foreground}>
        {line('nextPullRequestPage', 'next PR page')}
      </text>
      <text fg={theme?.foreground}>{line('refresh', 'refresh')}</text>
      <text fg={theme?.foreground}>{line('quit', 'quit')}</text>
      <text
        fg={theme?.foreground}
        attributes={TextAttributes.DIM}
        marginTop={1}
        flexShrink={0}
      >
        Esc close
      </text>
    </box>
  );
}
