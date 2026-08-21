---
Assigned-To:
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By:
  - 018-implement-review-submission-behavior
  - 020-connect-review-session-tool-actions
  - 024-replace-review-session-machinery-with-page-owned-loading
---

## Goal

Build the approved Review Queue and Review Submission presentation with OpenTUI React against `ReviewSession` snapshots and semantic actions.

## Done when

- The borderless GitHub-style queue, details, loading, empty, stale, failure, help, notice, and shutdown surfaces match accepted behavior.
- Effective queue key bindings dispatch semantic actions only while the queue owns input.
- The compact multiline Review Submission modal has isolated input, fixed controls, visible decisions, and in-flight locking.
- OpenTUI renderer tests cover key mapping, modal ownership, visual states, and non-color decision marks.
