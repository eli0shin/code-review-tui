import type { TextareaRenderable } from '@opentui/core';
import type { SystemTheme } from '../terminal/theme.ts';
import { stopKey } from '../terminal/keys.ts';
import { submissionStatus, type SubmissionDraft } from './draft.ts';

export function SubmissionModal({
  draft,
  editorRef,
  onInput,
  onClose,
  terminal,
  theme,
}: {
  readonly draft: SubmissionDraft;
  readonly editorRef: React.RefObject<TextareaRenderable | null>;
  readonly onInput: (message: string) => void;
  readonly onClose: () => void;
  readonly terminal: { readonly width: number; readonly height: number };
  readonly theme: SystemTheme | undefined;
}) {
  const width = Math.max(1, Math.min(78, terminal.width - 2));
  const height = Math.max(1, Math.min(18, terminal.height));
  const status = submissionStatus(draft, theme);
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
      paddingTop={0}
      paddingBottom={0}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="column"
    >
      <text fg={theme?.foreground}>
        <span fg={theme?.info}>
          <strong>{draft.target.repository}</strong>
        </span>
        <strong>{` #${draft.target.number}`}</strong>
      </text>
      <text fg={theme?.foreground}>{draft.target.title}</text>
      <text> </text>
      <textarea
        ref={editorRef}
        initialValue={draft.message}
        focused={!draft.inFlight}
        flexGrow={1}
        textColor={theme?.foreground}
        backgroundColor={theme?.background}
        focusedTextColor={theme?.foreground}
        focusedBackgroundColor={theme?.background}
        onContentChange={() => onInput(editorRef.current?.plainText ?? '')}
        onKeyDown={(key) => {
          if (key.name !== 'escape') return;
          stopKey(key);
          onClose();
        }}
      />
      <text fg={status.color}>{status.message}</text>
      <SubmissionHints narrow={width < 78} theme={theme} />
    </box>
  );
}

function SubmissionHints({
  narrow,
  theme,
}: {
  readonly narrow: boolean;
  readonly theme: SystemTheme | undefined;
}) {
  if (narrow) {
    return (
      <box flexDirection="column">
        <text fg={theme?.textMuted}>
          <strong>^A</strong> Approve{'   '}
          <strong>^C</strong> Comment
        </text>
        <text fg={theme?.textMuted}>
          <strong>^R</strong> Request changes{'   '}
          <strong>Esc</strong> Discard
        </text>
      </box>
    );
  }
  return (
    <box flexDirection="row" justifyContent="space-between">
      <text fg={theme?.textMuted}>
        <strong>Ctrl+A</strong> Approve
      </text>
      <text fg={theme?.textMuted}>
        <strong>Ctrl+C</strong> Comment
      </text>
      <text fg={theme?.textMuted}>
        <strong>Ctrl+R</strong> Request changes
      </text>
      <text fg={theme?.textMuted}>
        <strong>Esc</strong> Discard
      </text>
    </box>
  );
}
