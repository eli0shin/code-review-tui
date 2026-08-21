---
Assigned-To:
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By:
  - 024-replace-review-session-machinery-with-page-owned-loading
---

## Goal

Implement the `ToolTabs` port and Herdr v0.8.2 adapter from `docs/external-process-execution.md` and `docs/module-architecture.md`.

## Done when

- Fixed Lumen and opaque Review Commands launch as direct-process Tool Tabs with exact argv and environment.
- The adapter owns lifecycle correlation, launch uncertainty, acknowledgement, disconnect reconciliation, and pane-only cleanup.
- Ordinary matching exit causes one best-effort `pane.focus` request for the saved Review Queue pane.
- Fake-socket contract tests cover accepted Herdr v0.8.2 behavior. Do not model focus or event-ordering races or add protocol requirements.
