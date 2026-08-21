---
Assigned-To:
Tags:
  - task
  - hitl
Parent: 001-build-the-review-cli
Blocked-By:
  - 020-connect-review-queue-herdr-actions
  - 025-replace-herdr-socket-adapter-with-cli
---

## Goal

Finish the visible Review Queue and Review Submission UI.

## Done when

- The PR-list screen matches the accepted prototype literally: row content, spacing, hierarchy, Cursor highlight, and terminal-derived colors.
- The prototype frame, prototype switcher, surrounding background, and unrelated prototype colors are not copied into the application.
- The page shows simple loading, empty, and GitHub failure states.
- The pull request under the Cursor supplies the details pane.
- Queue keys work only when the Review Queue has input focus.
- The existing Review Submission behavior is presented in the accepted compact modal. Do not redesign its behavior.
- Renderer tests cover the visible states and key handling.
- The user reviews the rendered PR-list screen before this ticket is complete.
