---
Assigned-To:
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By:
  - 025-remove-herdr-lifecycle-machinery
---

## Goal

Connect Review Queue keys directly to Herdr.

## Done when

- Rename the public `ToolTabs` interface to `Herdr` and remove all “Tool Tab” terminology.
- Remove the public subscription, notice history, notice index, replay, and acknowledgement APIs.
- `d` opens `lumen diff` for the pull request under the Cursor.
- `c` opens the configured Review Command for the pull request under the Cursor.
- A launch failure is shown on the Review Queue page.
- Opening either command does not change the Review Queue or Cursor.
- Page tests prove the two key actions and visible launch failures.
