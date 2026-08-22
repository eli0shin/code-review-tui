---
Assigned-To:
Tags:
  - prototype
  - hitl
Parent:
Blocked-By: []
---

## Problem

The Review Submission modal interaction and its keyboard shortcuts are unacceptable. The user cannot efficiently write a review message, choose a decision, submit, recover from validation or process failure, or cancel with confidence.

All other application surfaces are settled and outside this prototype.

## Question

What focused Review Submission modal interaction and keymap let the user compose and submit one GitHub review quickly, predictably, and without mode or focus confusion?

## Prototype scope

Build a throwaway interactive prototype of the Review Submission modal only. The prototype starts with a fixed pull request target and ends when the modal submits or closes.

Prototype only these modal interactions:

1. Initial focus and visible target identity.
2. Multiline message editing.
3. Choosing Comment, Approve, or Request Changes.
4. Moving focus between the message and decision controls.
5. Submitting and showing in-flight state.
6. Decision-specific validation, including empty-message rules.
7. Submission failure with the exact draft and decision preserved.
8. Canceling an unchanged draft.
9. Canceling a changed draft and choosing whether to keep editing or discard it.
10. Discovering the modal's effective keyboard controls.

Use representative modal states: untouched draft, long multiline message, each decision, validation failure, submission in flight, submission failure with a long diagnostic, discard confirmation, and narrow terminal rendering.

## Hard scope boundary

Do not prototype or redesign:

- the Pull Request List;
- pull request details;
- Lumen or Review Command launch and return;
- application help;
- global refresh or quit behavior;
- loading, empty, or failure states outside Review Submission;
- application navigation, layout, colors, or any other settled surface.

Represent surrounding application content only as an inert backdrop. It has no interactive behavior in this prototype.

## Design exploration

- Produce multiple structurally distinct Review Submission modal and keymap variants. Cosmetic variations of one interaction do not count.
- Treat editor ownership, decision selection, focus movement, submit, cancel, and discard confirmation as one modal interaction model.
- Make every context-dependent key meaning visible during the session.
- Separate text-editing controls from modal actions so typing a review message cannot trigger an application action.
- Explore direct decision shortcuts, focus-based controls, explicit chords, and another coherent alternative where useful.
- Keep controls discoverable without covering the message or consuming most of the modal.
- Do not preserve the current modal keymap for compatibility. The accepted prototype can replace defaults and the user's personal configuration.
- Do not modify production interaction code, configuration schema, documentation, or defaults in this ticket.

## HITL session

Run the modal prototype interactively with the user. For every variant, ask the user to write, change, submit, fail, retry, cancel, and discard realistic Review Submissions without coaching each keystroke.

Record each hesitation, wrong action, focus mistake, accidental cancellation, undiscoverable control, and point where the modal hides the draft, decision, target, or failure.

The session is complete only when the user explicitly accepts:

- modal layout and focus model;
- complete default keymap for each modal state;
- decision selection behavior;
- submit and in-flight behavior;
- validation placement and recovery;
- failure presentation and retry behavior;
- unchanged cancel and changed-draft discard behavior;
- control discoverability;
- which modal controls are configurable and which are fixed for safe editing.

## Deliverable

Preserve the accepted Review Submission modal prototype at a commit that can be run again. Record the accepted interaction contract and rejected alternatives in this ticket's resolution. Create separate implementation tickets only after explicit user acceptance. The prototype is throwaway and must not be imported into production code.
