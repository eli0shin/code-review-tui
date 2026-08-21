---
Assigned-To:
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By:
  - 017-implement-review-session-queue-and-details
  - 019-implement-herdr-tool-tabs-adapter
  - 024-replace-review-session-machinery-with-page-owned-loading
---

## Goal

Connect Lumen, Review Command, lifecycle notices, indeterminate-launch acknowledgement, and shutdown to `ReviewSession` through `ToolTabs`.

## Done when

- Tool actions capture and send the selected pull request without changing queue or review-progress state.
- Tool notices and acknowledgement appear as semantic session state and actions.
- Shutdown is irreversible, rejects new actions, and delegates owned cleanup.
- In-memory port tests cover launches, notices, acknowledgement, completion, concurrent tools, and cleanup failures.
