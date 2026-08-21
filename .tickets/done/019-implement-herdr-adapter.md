---
Assigned-To: code-review-tui@019-implement-herdr-adapter
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Goal

Implement the Herdr v0.8.2 adapter.

## Delivered

- Open Lumen and Review Commands in Herdr tabs with exact arguments and environment.
- Make one best-effort attempt to focus the Review Queue pane after a command exits.
- Detect a closed Review Queue pane.
- Disconnect without closing Herdr tabs.
- Test the Herdr socket boundary with a fake server.

## Follow-up

Ticket 020 removes the public subscription and acknowledgement APIs introduced with this adapter.

## Resolution

Implemented and merged in PR #17 as commit `2ebac7d483f88d4d2481a87f8542df46c35c2ad1`.
