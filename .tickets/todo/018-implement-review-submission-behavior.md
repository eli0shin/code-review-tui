---
Assigned-To:
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By:
  - 017-implement-review-session-queue-and-details
  - 024-replace-review-session-machinery-with-page-owned-loading
---

## Goal

Implement Review Submission state and actions in `ReviewSession` from `docs/review-submission-interaction.md`.

## Done when

- The session captures the target, exact message, and explicit decision.
- Validation, discard confirmation, in-flight locking, and cancellation match the accepted interaction.
- Failures preserve the draft for retry; success closes the modal and starts queue refresh without optimistic queue changes.
- Session contract tests cover comment, approve, request-changes, retry, discard, and stale-operation behavior.
