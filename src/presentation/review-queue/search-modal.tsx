import type { TextareaRenderable } from '@opentui/core';
import type { SystemTheme } from '../terminal/theme.ts';
import { stopKey } from '../terminal/keys.ts';

export function SearchModal({
  text,
  validation,
  editorRef,
  onInput,
  onClose,
  terminal,
  theme,
}: {
  readonly text: string;
  readonly validation: string | undefined;
  readonly editorRef: React.RefObject<TextareaRenderable | null>;
  readonly onInput: (text: string) => void;
  readonly onClose: () => void;
  readonly terminal: { readonly width: number; readonly height: number };
  readonly theme: SystemTheme | undefined;
}) {
  const width = Math.max(1, Math.min(90, terminal.width - 2));
  const height = Math.max(1, Math.min(9, terminal.height));
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
      <text fg={theme?.foreground}>
        <strong>Review Queue query</strong>
      </text>
      <text fg={theme?.textMuted}>Applies only to this session.</text>
      <textarea
        ref={editorRef}
        initialValue={text}
        focused
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
      <text fg={theme?.error}>{validation ?? ' '}</text>
      <text fg={theme?.textMuted}>Enter apply · Esc cancel</text>
    </box>
  );
}
