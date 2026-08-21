---
Assigned-To:
Tags:
  - task
  - hitl
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Decision

The `ReviewSession` design merged in PR #15 is rejected wholesale. It is unnecessary machinery for this application and must not be extended.

The OpenTUI React Review Queue page owns its data and loading behavior:

1. When the page opens, it loads pull requests.
2. When the user presses `r`, it loads pull requests.
3. While the page is open, one timer loads pull requests at a fixed interval.

All three triggers call the same page-owned load function.

## Required cleanup

- Delete `ReviewSession`, its snapshot API, subscriptions, listener set, refresh queue, pending-load coalescing, request generations, and reentrancy protocols.
- Delete the session contract tests and the changeset introduced by PR #15.
- Remove `ReviewSession` from `docs/module-architecture.md` and all downstream implementation plans.
- Keep the existing `GitHub` adapter as the external process boundary.
- Keep only ordinary page state needed to render pull requests, selection, details, loading, and errors.
- Do not add a store, event bus, controller, state machine, scheduler service, or replacement subscription interface.
- Stop the timer when the page unmounts.
- Test the three load triggers and timer cleanup through the page. Do not recreate session-level orchestration tests.

## HITL gate

The user must confirm the fixed timer interval and authorize implementation before work starts. No downstream implementation work is authorized before this cleanup is accepted.
