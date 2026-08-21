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

TanStack React Query owns Review Queue and detail data, query status, polling, and cancellation in the OpenTUI React page. The page keeps only the selected pull request URL as local selection state. Page tests cover visible behavior and direct calls to the approved `GitHub` port.
