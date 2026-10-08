import {
  normalizeTerminalPalette,
  RGBA,
  type TerminalColors,
} from '@opentui/core';
import { useRenderer } from '@opentui/react';
import { useEffect, useState } from 'react';

export type SystemTheme = {
  readonly success: RGBA;
  readonly error: RGBA;
  readonly info: RGBA;
  readonly secondary: RGBA;
  readonly warning: RGBA;
  readonly textMuted: RGBA;
  readonly foreground: RGBA;
  readonly background: RGBA;
  readonly selectionForeground: RGBA;
  readonly selectionBackground: RGBA;
  readonly subtleSurface: RGBA;
};

export function reviewStateColor(
  state: string,
  theme: SystemTheme | undefined
): RGBA | undefined {
  if (theme === undefined) return undefined;
  const normalizedState = state.toUpperCase();
  if (normalizedState === 'APPROVED') return theme.success;
  if (normalizedState === 'CHANGES_REQUESTED') return theme.error;
  if (normalizedState === 'REVIEW_REQUIRED') return theme.warning;
  if (normalizedState === 'COMMENTED' || normalizedState === 'PENDING') {
    return theme.info;
  }
  return theme.foreground;
}

export function checkStateColor(
  state: string,
  theme: SystemTheme | undefined
): RGBA | undefined {
  if (theme === undefined) return undefined;
  const normalizedState = state.toUpperCase();
  if (normalizedState === 'SUCCESS') return theme.success;
  if (
    normalizedState === 'FAILURE' ||
    normalizedState === 'ERROR' ||
    normalizedState === 'CANCELLED'
  ) {
    return theme.error;
  }
  return theme.info;
}

export function useSystemTheme(): SystemTheme {
  const renderer = useRenderer();
  const [theme, setTheme] = useState<SystemTheme>(fallbackSystemTheme);

  useEffect(() => {
    let active = true;
    void renderer
      .getPalette({ size: 16 })
      .then((colors) => {
        const detectedTheme = generateSystemTheme(colors);
        if (active && detectedTheme !== undefined) setTheme(detectedTheme);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [renderer]);

  return theme;
}

function generateSystemTheme(colors: TerminalColors): SystemTheme | undefined {
  const background = colors.defaultBackground ?? colors.palette[0];
  if (!background) return undefined;

  const bg = RGBA.fromHex(background);
  const foreground = colors.defaultForeground ?? colors.palette[7] ?? '#c0c0c0';
  const fg = RGBA.fromHex(foreground);
  const isDark = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b <= 0.5;
  const color = (index: number, fallback: string) =>
    RGBA.fromHex(colors.palette[index] ?? fallback);

  return {
    success: color(2, '#008000'),
    error: color(1, '#800000'),
    info: color(6, '#008080'),
    secondary: color(5, '#800080'),
    warning: color(3, '#808000'),
    textMuted: generateMutedTextColor(bg, isDark),
    foreground: RGBA.defaultForeground(),
    background: RGBA.defaultBackground(),
    selectionForeground: colors.highlightForeground
      ? RGBA.fromHex(colors.highlightForeground)
      : bg,
    selectionBackground: colors.highlightBackground
      ? RGBA.fromHex(colors.highlightBackground)
      : fg,
    subtleSurface: tint(bg, fg, isDark ? 0.14 : 0.1),
  };
}

function createFallbackSystemTheme(): SystemTheme {
  const colors = normalizeTerminalPalette();
  const bg = colors.defaultBackground;
  const fg = colors.defaultForeground;
  const isDark = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b <= 0.5;
  return {
    success: colors.palette[2] ?? fg,
    error: colors.palette[1] ?? fg,
    info: colors.palette[6] ?? fg,
    secondary: colors.palette[5] ?? fg,
    warning: colors.palette[3] ?? fg,
    textMuted: generateMutedTextColor(bg, isDark),
    foreground: RGBA.defaultForeground(),
    background: RGBA.defaultBackground(),
    selectionForeground: bg,
    selectionBackground: fg,
    subtleSurface: tint(bg, fg, isDark ? 0.14 : 0.1),
  };
}

export const fallbackSystemTheme = createFallbackSystemTheme();

function tint(base: RGBA, overlay: RGBA, alpha: number): RGBA {
  return RGBA.fromInts(
    Math.round((base.r + (overlay.r - base.r) * alpha) * 255),
    Math.round((base.g + (overlay.g - base.g) * alpha) * 255),
    Math.round((base.b + (overlay.b - base.b) * alpha) * 255)
  );
}

function generateMutedTextColor(background: RGBA, isDark: boolean): RGBA {
  const backgroundLuminance =
    0.299 * background.r * 255 +
    0.587 * background.g * 255 +
    0.114 * background.b * 255;

  const gray = isDark
    ? backgroundLuminance < 10
      ? 180
      : Math.min(Math.floor(160 + backgroundLuminance * 0.3), 200)
    : backgroundLuminance > 245
      ? 75
      : Math.max(Math.floor(100 - (255 - backgroundLuminance) * 0.2), 60);

  return RGBA.fromInts(gray, gray, gray);
}
