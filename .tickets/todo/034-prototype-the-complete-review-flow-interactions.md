---
Assigned-To:
Tags:
  - prototype
  - hitl
Parent:
Blocked-By: []
---

## Problem

The current Review Queue, pull request details, external-tool launch, and Review Submission interactions do not form a coherent review flow. Keyboard shortcuts are difficult to remember, conflict with expected terminal conventions, change meaning between surfaces, and do not make the active input owner clear. Incremental shortcut changes must stop until the complete interaction model is evaluated with the user.

## Question

What complete keyboard-driven review flow lets the user move from the Review Queue through context reading, Lumen or Review Command work, and Review Submission with predictable controls, visible state, and minimal mode confusion?

## Prototype scope

Build a throwaway interactive prototype for a live human-in-the-loop session. Prototype the complete flow rather than one isolated modal:

1. Scan and navigate the Review Queue.
2. Open, read, scroll, refresh, inspect failures in, and close pull request details.
3. Launch Lumen and the Review Command while preserving a clear return path.
4. Open Review Submission, edit its message, choose a decision, submit, handle validation or process failure, cancel, and confirm discard.
5. Open and close help, understand current controls, and quit safely.

Use representative states: a long queue, a long description, a long mixed review conversation, pending and failed checks, independent source failures, an empty queue, loading, Review Submission validation, submission failure, and a narrow terminal.

## Design exploration

- Produce multiple structurally distinct interaction and keymap variants. Do not present cosmetic variants of one model as separate choices.
- Treat input ownership, modal layering, return behavior, and key meaning as one design problem.
- Explore whether actions should use mnemonic single keys, Vim-style movement, conventional terminal paging, explicit chords, command palettes, contextual menus, or another coherent model.
- Identify every context where one key changes meaning. Make each conflict visible during the session instead of silently resolving it in code.
- Show effective controls where they are needed without filling the screen with permanent shortcut noise.
- Include configurable bindings in the design. Separate controls that must be fixed for safe text editing from Review Queue actions that users can configure.
- Do not preserve the current keymap merely for compatibility. There are no external-user migration requirements. The accepted flow can replace generated defaults and the user's personal configuration.
- Do not change production interaction code, configuration schema, documentation, or defaults as part of this ticket.

## HITL session

Run the prototype interactively with the user. Let the user perform realistic review tasks in each variant without coaching each keystroke. Record where the user hesitates, invokes the wrong action, loses context, cannot discover an action, or cannot return to the prior surface.

The session is not complete until the user explicitly accepts:

- the surface and focus model;
- the complete default keymap in every context;
- open, close, cancel, and quit behavior;
- scrolling and paging behavior;
- Lumen and Review Command launch and return behavior;
- Review Submission editing and decision controls;
- help and shortcut discoverability;
- configuration boundaries and collision rules.

## Deliverable

Preserve the accepted prototype at a commit that can be run again. Record the accepted interaction contract and rejected alternatives in this ticket's resolution. Create separate implementation tickets only after explicit user acceptance. The prototype itself is throwaway and must not be imported into production code.
