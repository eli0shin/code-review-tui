import {
  CliRenderEvents,
  TextBufferRenderable,
  type Selection,
} from '@opentui/core';
import { useRenderer } from '@opentui/react';
import { useEffect } from 'react';
import type { SystemTheme } from './theme.ts';

export function useCopyCompletedSelection(theme: SystemTheme): void {
  const renderer = useRenderer();

  useEffect(() => {
    const handleSelection = (selection: Selection) => {
      for (const renderable of selection.selectedRenderables) {
        if (renderable instanceof TextBufferRenderable) {
          renderable.selectionBg = theme.selectionBackground;
          renderable.selectionFg = theme.selectionForeground;
        }
      }

      if (selection.isDragging) return;
      const text = selection.getSelectedText();
      if (text.trim().length === 0) return;
      renderer.copyToClipboardOSC52(text);
    };

    renderer.on(CliRenderEvents.SELECTION, handleSelection);
    return () => {
      renderer.off(CliRenderEvents.SELECTION, handleSelection);
    };
  }, [renderer, theme.selectionBackground, theme.selectionForeground]);
}
