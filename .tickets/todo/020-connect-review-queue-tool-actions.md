---
Assigned-To:
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Goal

Connect the OpenTUI React Review Queue page directly to `ToolTabs` for Lumen, Review Command, lifecycle notices, and indeterminate-launch acknowledgement. Connect runtime shutdown directly to `ToolTabs`.

## Done when

- Page actions capture and send the pull request under the Cursor without changing the Review Queue or adding review-progress state.
- Ordinary page state shows tool notices and acknowledgement actions.
- Runtime shutdown rejects new page actions and delegates owned cleanup.
- OpenTUI page tests cover actions and visible notices; Tool Tabs adapter tests cover launches, acknowledgement, completion, concurrent tools, and cleanup failures.
- No intermediate controller, store, event bus, or replacement subscription interface is added.
