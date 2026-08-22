---
Assigned-To: code-review-tui@035-use-review-queue-colors-on-every-application-surface
Tags:
  - bug
  - ui
Parent:
Blocked-By: []
---

## Problem

The Review Queue list has the accepted terminal background, foreground text, semantic accents, and highlighted-row treatment. Other application surfaces introduce different background and text colors, especially pull request details and help. The result looks like unrelated themes inside one application and makes text difficult to read.

## Outcome

Use the accepted Review Queue color language on every application-owned surface. The terminal's normal background and foreground are the application baseline. Reuse only the same semantic accent roles already used by Review Queue rows. Do not create a separate modal, help, error, or submission color scheme.

## Contract

Audit and correct every surface rendered by `review`, including:

- pull request details and its loading, partial-failure, and key-guidance content;
- effective-key help;
- Review Submission, validation, discard confirmation, in-flight, and failure states;
- bounded error diagnostics;
- initial loading, empty, and unavailable states;
- queue refresh and action diagnostics, notices, and footer guidance.

Apply these rules:

- Keep the accepted Review Queue row colors and highlighted-row background unchanged.
- Use the terminal's normal background for the application root and all full-screen, modal, overlay, help, submission, status, and diagnostic surfaces. Do not use a generated surface color, alternate panel background, modal background, or unrelated opaque fill.
- Use the terminal's normal foreground for ordinary titles, bodies, descriptions, comments, reviews, help text, editor text, and control labels. Do not replace ordinary text with a modal-specific foreground.
- Reuse the Review Queue's existing semantic roles consistently: muted metadata, repository/info, author/secondary, success/additions, error/deletions and failures, and warning/labels where those meanings apply.
- Do not add new hard-coded RGB colors, ANSI color choices, opacity rules, inversions, or a second palette.
- Borders, emphasis, and the persistent selected decision marker must not introduce a different text or background scheme. Color cannot be the only signal for state.
- Preserve all layout, content, scrolling, input ownership, configurable bindings, Review Submission behavior, diagnostics, and terminal palette detection.
- Remove theme fields or color derivation that exist only to support the rejected alternate surface backgrounds when they become unused.
- Update UI/theme documentation to state that every surface shares the Review Queue baseline.
- Add a patch changeset.

## Acceptance evidence

- OpenTUI coverage inspects rendered color values, not only captured characters.
- Coverage proves the Review Queue row and highlighted-row colors are unchanged.
- Coverage proves details, help, Review Submission, discard confirmation, loading/empty/error states, and diagnostics use the same terminal background and ordinary foreground as the Review Queue.
- Coverage proves semantic accents on non-queue surfaces use the same tokens as equivalent Review Queue accents.
- Coverage runs against representative light and dark terminal palettes so no surface silently introduces a theme-specific alternate background or foreground.
- Existing interaction and native executable tests continue to pass.
