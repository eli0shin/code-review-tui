---
Assigned-To:
Tags:
  - wayfinder-map
Parent:
Blocked-By: []
---

## Destination

Build the complete `review` CLI:

- show pull requests returned by the configured GitHub search;
- move a Cursor through the visible rows;
- open Lumen or the Review Command for the pull request under the Cursor;
- submit comment, approve, or request-changes reviews.

## Rules

- Use TypeScript, Bun, OpenTUI React, `gh`, `lumen diff`, and Herdr.
- The Review Queue is the latest successful GitHub search result. Do not track review progress locally.
- TanStack React Query owns GitHub data. The page owns one numeric Cursor.
- Call external programs directly. Do not add a store, controller, event bus, listener API, or lifecycle protocol.
- Call Herdr tabs **Herdr tabs**. Do not use “Tool Tab” or `ToolTabs`.
- Review Commands are opaque configured shell commands. Do not hard-code Pi.

## Completed

- [Review configuration](../done/015-implement-strict-review-configuration.md)
- [GitHub CLI adapter](../done/016-implement-github-cli-data-adapter.md)
- [Page-owned Review Queue loading](../done/024-replace-review-session-machinery-with-page-owned-loading.md)
- [Review Submission behavior](../done/018-implement-review-submission-behavior.md)
- [Herdr adapter](../done/019-implement-herdr-adapter.md)

## Remaining

1. [Connect Review Queue Herdr actions](020-connect-review-queue-herdr-actions.md)
2. [Build the Review Queue UI](021-build-opentui-review-queue-and-submission.md)
3. [Compose the executable](022-compose-review-startup-shutdown-and-smoke-tests.md)
4. [Validate the finished CLI](023-validate-first-review-release.md)

## Out of scope

- Inline pull request comments.
- Local checkout or worktree management.
- Application-managed GitHub accounts.
- Review-progress tracking.
