---
Assigned-To:
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By:
  - 020-connect-review-queue-tool-actions
---

## Goal

Complete the approved OpenTUI React Review Queue page and Review Submission presentation around TanStack React Query remote state, one numeric Cursor, and direct port calls.

## Done when

- The borderless GitHub-style queue, details, loading, empty, failure, help, notice, and shutdown surfaces match accepted behavior.
- Effective queue key bindings act only while the queue owns input.
- The compact multiline Review Submission modal has isolated input, fixed controls, visible decisions, and in-flight locking.
- OpenTUI renderer tests cover direct page behavior, key mapping, modal ownership, visual states, and non-color decision marks.
- The implementation uses query status for remote loading and failures and does not add a second state copy or an application-state coordination layer.
