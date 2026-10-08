import type { KeyEvent, TextareaRenderable } from '@opentui/core';
import { useRef, useState } from 'react';
import type {
  PullRequestSummary,
  ReviewDecision,
} from '../../domain/pull-request.ts';
import type { GitHub } from '../../github/types.ts';
import {
  createDraft,
  handleSubmissionKey,
  reviewActionLabel,
  type SubmissionDraft,
} from './draft.ts';

export function useReviewSubmission(github: GitHub, onSubmitted: () => void) {
  const [draft, setDraft] = useState<SubmissionDraft>();
  const editorRef = useRef<TextareaRenderable>(null);
  const draftOpenRef = useRef(false);
  const submissionActiveRef = useRef(false);
  const submissionIdRef = useRef(0);
  const controllerRef = useRef<AbortController | undefined>(undefined);

  function open(target: PullRequestSummary): void {
    draftOpenRef.current = true;
    setDraft(createDraft(target));
  }

  function close(): void {
    draftOpenRef.current = false;
    submissionIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = undefined;
    submissionActiveRef.current = false;
    setDraft(undefined);
  }

  function updateMessage(message: string): void {
    setDraft((current) =>
      current === undefined
        ? current
        : {
            ...current,
            message,
            action: current.inFlight ? current.action : undefined,
            validation: undefined,
            failure: current.inFlight ? current.failure : undefined,
          }
    );
  }

  async function submit(
    submission: SubmissionDraft,
    action: ReviewDecision,
    message: string
  ): Promise<void> {
    if (!draftOpenRef.current || submissionActiveRef.current) return;
    const attempt = { ...submission, message, action };
    if (action !== 'approve' && !/\S/.test(message)) {
      setDraft({
        ...attempt,
        validation: `${reviewActionLabel(action)} requires a nonblank message.`,
      });
      return;
    }
    submissionActiveRef.current = true;
    const submissionId = submissionIdRef.current + 1;
    submissionIdRef.current = submissionId;
    const controller = new AbortController();
    controllerRef.current = controller;

    setDraft({
      ...attempt,
      failure: undefined,
      validation: undefined,
      inFlight: true,
    });
    const result = await github.submitReview(
      { url: attempt.target.url, message, decision: action },
      controller.signal
    );
    if (submissionIdRef.current !== submissionId) return;
    submissionActiveRef.current = false;
    controllerRef.current = undefined;
    if (!result.ok) {
      setDraft({ ...attempt, failure: result.failure, inFlight: false });
      return;
    }

    draftOpenRef.current = false;
    setDraft(undefined);
    onSubmitted();
  }

  function handleKey(key: KeyEvent): void {
    if (draft === undefined) return;
    handleSubmissionKey(
      key,
      draft,
      editorRef.current?.plainText ?? draft.message,
      submit,
      close
    );
  }

  return { draft, editorRef, open, close, updateMessage, handleKey };
}
