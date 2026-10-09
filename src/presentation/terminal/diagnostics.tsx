import { TextAttributes, type ScrollBoxRenderable } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/react';
import type { GitHubFailure } from '../../github/types.ts';
import type { HerdrFailure } from '../../tools/types.ts';
import type { SystemTheme } from './theme.ts';
import { centeredStatusLines } from './text-layout.ts';

export function StatusView({
  title,
  detail,
  theme,
  error = false,
}: {
  readonly title: string;
  readonly detail?: string;
  readonly theme: SystemTheme | undefined;
  readonly error?: boolean;
}) {
  const terminal = useTerminalDimensions();
  return (
    <box
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      gap={1}
    >
      <text fg={error ? theme?.error : undefined}>
        <strong>{title}</strong>
      </text>
      {detail !== undefined ? (
        <box flexDirection="column" alignItems="center" width="100%">
          {centeredStatusLines(detail, terminal.width).map(({ key, text }) => (
            <text key={key} fg={theme?.textMuted}>
              {text}
            </text>
          ))}
        </box>
      ) : null}
    </box>
  );
}

export function FailureOverlay({
  ref,
  title,
  message,
  theme,
}: {
  readonly ref: React.Ref<ScrollBoxRenderable>;
  readonly title: string;
  readonly message: string;
  readonly theme: SystemTheme | undefined;
}) {
  return (
    <box
      position="absolute"
      left="15%"
      top="15%"
      width="70%"
      height="70%"
      zIndex={15}
      border
      borderColor={theme?.error}
      backgroundColor={theme?.background}
      padding={1}
      flexDirection="column"
    >
      <text flexShrink={0} fg={theme?.foreground}>
        <strong>{title}</strong>
      </text>
      <scrollbox
        ref={ref}
        flexGrow={1}
        scrollY
        viewportCulling
        contentOptions={{ flexDirection: 'column', paddingRight: 1 }}
      >
        {failureMessageLines(message).map((line) => (
          <text
            key={line.key}
            width="100%"
            wrapMode="char"
            fg={theme?.foreground}
          >
            {line.text}
          </text>
        ))}
        <box height={1} />
      </scrollbox>
      <text
        flexShrink={0}
        fg={theme?.foreground}
        attributes={TextAttributes.DIM}
      >
        ↑/↓ scroll PgUp/PgDn page Home/End Esc return
      </text>
    </box>
  );
}

export function herdrFailureMessage(failure: HerdrFailure): string {
  const message =
    failure.exitCode === undefined
      ? failure.message
      : `${failure.message} (exit code ${failure.exitCode})`;
  return message;
}

export function githubFailureKey(failure: GitHubFailure): string {
  const url = 'url' in failure ? failure.url : '';
  const stderr = 'stderr' in failure ? failure.stderr : '';
  const diagnostic = 'diagnostic' in failure ? failure.diagnostic : '';
  return `${failure.operation}:${url}:${failure.kind}:${diagnostic}:${stderr}`;
}

export function failureMessage(failure: GitHubFailure): string {
  switch (failure.kind) {
    case 'startup':
      return failure.diagnostic;
    case 'malformedData':
    case 'incompatibleData':
      return failure.stderr
        ? `${failure.diagnostic}\n${failure.stderr}`
        : failure.diagnostic;
    case 'exit':
      return failure.stderr || `gh exited with code ${failure.exitCode}`;
    case 'interrupted': {
      const diagnostic = failure.diagnostic || failure.reason;
      return failure.stderr ? `${diagnostic}\n${failure.stderr}` : diagnostic;
    }
  }
}

function failureMessageLines(
  message: string
): readonly { readonly key: string; readonly text: string }[] {
  let offset = 0;
  return message.split('\n').map((text) => {
    const line = { key: `${offset}:${text}`, text };
    offset += text.length + 1;
    return line;
  });
}
