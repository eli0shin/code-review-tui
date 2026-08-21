---
Assigned-To: code-review-tui@018-implement-review-submission-behavior
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Goal

Implement Review Submission state and actions directly in the OpenTUI React Review Queue page from `docs/review-submission-interaction.md`.

## Done when

- Ordinary page state captures the target, exact message, and explicit decision.
- Validation, discard confirmation, in-flight locking, and cancellation match the accepted interaction.
- Failures preserve the draft, keep the modal open, and show the error without changing the submission controls or automatically starting another submission. Success closes the modal and calls the page-owned pull request load function without optimistic queue changes.
- OpenTUI page tests cover comment, approve, request-changes, retry, discard, and visible operation behavior.
- No store, controller, subscription interface, state machine, request generation, or other coordination layer is added.
