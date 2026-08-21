---
Assigned-To:
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Decision

The `ReviewSession` design merged in PR #15 is rejected wholesale. It is unnecessary machinery for this application and must not be extended.

The OpenTUI React Review Queue page owns its data and loading behavior:

1. When the page opens, it loads pull requests.
2. When the user presses `r`, it loads pull requests.
3. While the page is open, one timer loads pull requests every 60 seconds.

All three triggers call the same page-owned load function.

## Required cleanup

- Delete `ReviewSession`, its snapshot API, subscriptions, listener set, refresh queue, pending-load coalescing, request generations, and reentrancy protocols.
- Delete the session contract tests and the changeset introduced by PR #15.
- Remove `ReviewSession` from `docs/module-architecture.md` and all downstream implementation plans.
- Keep the existing `GitHub` adapter as the external process boundary.
- Use TanStack React Query for remote queue and detail state unless a concrete OpenTUI incompatibility is demonstrated. If it is incompatible, stop and report the incompatibility before adding custom machinery.
- Let query `status` represent pending, error, and success. Do not create separate loading and failure `useState` values.
- Keep only one local selection value: the selected pull request URL. Derive the effective selection from that URL and current query data.
- The queue query loads on mount, uses `refetchInterval: 60_000`, and exposes `refetch()` for `r`. Its query function must use React Query's abort signal.
- Key the details query by the effective selected URL. Do not clone pull request objects or use object identity to trigger reloads.
- Do not add fetch effects, timer effects, a store, event bus, controller, reducer, state machine, scheduler service, or replacement subscription interface.
- Test the three queue-load triggers, query cancellation on unmount, URL-only selection, details loading, and status rendering through the page. Do not recreate session-level orchestration tests.

## Authorization

The user selected a fixed 60-second interval and authorized this cleanup. No downstream implementation work can resume before this cleanup is accepted.
