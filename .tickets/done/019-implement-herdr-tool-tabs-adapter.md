---
Assigned-To: code-review-tui@019-implement-herdr-tool-tabs-adapter
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Goal

Implement the `ToolTabs` port and Herdr v0.8.2 adapter from `docs/external-process-execution.md` and `docs/module-architecture.md`.

## Done when

- Fixed Lumen and opaque Review Commands launch as direct-process Tool Tabs with exact argv and environment.
- The adapter owns lifecycle correlation, launch uncertainty, acknowledgement, and disconnect reconciliation. Shutdown does not close Tool Tab panes.
- Ordinary matching exit causes one best-effort `pane.focus` request for the saved Review Queue pane.
- Fake-socket contract tests cover accepted Herdr v0.8.2 behavior. Do not model focus or event-ordering races or add protocol requirements.

## Resolution

Implemented and merged in PR #17 as commit `2ebac7d483f88d4d2481a87f8542df46c35c2ad1`.
