import type { KeyEvent, TextareaRenderable } from '@opentui/core';
import { useRef, useState } from 'react';
import { stopKey } from '../terminal/keys.ts';
import type { useReviewQueue } from './use-review-queue.ts';

export function useQueueSearch(
  reviewQueue: Pick<
    ReturnType<typeof useReviewQueue>,
    'list' | 'searchText' | 'applySearch'
  >,
  onApplied: () => void
) {
  const [draft, setDraft] = useState<string>();
  const [validation, setValidation] = useState<string>();
  const editorRef = useRef<TextareaRenderable>(null);

  function open(): void {
    if (reviewQueue.list !== 'reviewQueue') return;
    setValidation(undefined);
    setDraft(reviewQueue.searchText);
  }

  function close(): void {
    setDraft(undefined);
    setValidation(undefined);
  }

  function updateText(text: string): void {
    setDraft(text);
    setValidation(undefined);
  }

  function handleKey(key: KeyEvent): void {
    if (draft === undefined) return;
    if (key.name === 'escape') {
      stopKey(key);
      close();
    } else if (key.name === 'return' || key.name === 'enter') {
      stopKey(key);
      const text = editorRef.current?.plainText ?? draft;
      const parsed = reviewQueue.applySearch(text);
      if (!parsed.ok) {
        setValidation(parsed.problem);
        return;
      }
      onApplied();
      close();
    }
  }

  return { draft, validation, editorRef, open, close, updateText, handleKey };
}
