---
Assigned-To: code-review-tui@017-implement-review-session-queue-and-details
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Rejected result

The implementation merged by this ticket is rejected wholesale. Ticket 024 deletes its application-state module, contract tests, and changeset. Do not extend or restore its snapshots, subscriptions, refresh queue, request generations, coalescing, or reentrancy behavior.

Review Queue loading, selection, details, loading indicators, and failures belong directly to the OpenTUI React page as ordinary state. Page tests cover visible behavior and direct calls to the approved `GitHub` port.
