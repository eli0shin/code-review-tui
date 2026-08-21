---
Assigned-To:
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Goal

Connect Review Queue keys to the `Herdr` CLI adapter.

## Done when

- `d` opens `lumen diff` for the pull request under the Cursor.
- `c` opens the configured Review Command for the pull request under the Cursor.
- An immediate CLI failure is shown on the Review Queue page.
- Opening either command does not change the Review Queue or Cursor.
- Page tests prove the two key actions and visible failures.
