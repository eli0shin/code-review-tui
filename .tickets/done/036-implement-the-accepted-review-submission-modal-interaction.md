---
Assigned-To: Pi
Tags:
  - implementation
  - ui
Parent:
Blocked-By: []
---

## Problem

The production Review Submission modal uses separate editor and decision focus states, a decision selector, a separate submit command, and a discard confirmation. Prototype ticket 034 proved that this interaction is too slow and confusing for repeated keyboard use.

## Accepted contract

- Keep one multiline editor active for the complete modal session.
- Remove decision focus, decision selection, separate submit, and discard confirmation.
- `Ctrl+A` immediately approves, `Ctrl+C` immediately comments, and `Ctrl+R` immediately requests changes with the exact current message.
- `Esc` immediately closes and discards without confirmation.
- Permit an empty approval. Require a nonblank message for Comment and Request Changes.
- Ignore duplicate review chords in flight and show only the applicable progress message in a reserved status row.
- Preserve the exact draft after validation or submission failure and permit direct retry.
- Put repository and number on the first line, title on the second line, and one blank line before the editor.
- Use a borderless editor aligned with the target text.
- Do not show a modal heading, explanatory editor sentence, or blank line below the subdued hints.
- Keep a compact preferred modal size and provide a usable narrow-terminal layout.

## Prototype source

Branch `prototype/review-submission-modal`, commit `671613a`. Variant A is accepted. Variants B and C are rejected.

## Acceptance criteria

- Each direct review chord submits the correct GitHub review and exact multiline message.
- Empty-message validation follows the accepted action rules without moving or clearing the draft.
- In-flight and failure states preserve the draft and permit the accepted actions.
- `Esc` closes immediately without confirmation for unchanged, changed, and in-flight drafts.
- The target, editor, reserved status row, and subdued hints match the accepted spacing and alignment.
- Production tests and user documentation agree with the fixed modal keymap.

## Resolution

Implemented the accepted editor-first Review Submission modal in the production TUI.

The modal now submits exact drafts through direct `Ctrl+A`, `Ctrl+C`, and `Ctrl+R` action chords and discards immediately with `Esc`. It preserves drafts through validation and process failure, blocks duplicate or post-discard batched actions, aborts an in-flight process on close, keeps progress in a reserved status row, and uses the accepted target, editor, and hint layout at desktop and narrow sizes.

Updated the interaction contract and README. TUI integration tests cover exact multiline submission, all action rules, failure and retry, immediate discard, in-flight abort, batched-input races, layout stability, alignment, subdued colors, and narrow rendering.
