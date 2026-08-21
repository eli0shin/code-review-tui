---
Assigned-To: code-review-tui@019-implement-herdr-adapter
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Goal

Implement the Herdr adapter.

## Resolution

PR #17 merged a direct Herdr socket client as commit `2ebac7d483f88d4d2481a87f8542df46c35c2ad1`.

That implementation is rejected wholesale. Ticket 025 replaces it with direct execution of the installed `herdr` CLI.
