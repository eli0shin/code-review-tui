---
Assigned-To: code-review-tui@031-close-completed-herdr-tabs
Tags:
  - implementation
  - herdr
Parent:
Blocked-By: []
---

## Problem

A Herdr tab created for Lumen or a Review Command remains open as a dead shell after the launched command exits. The injected command currently makes only a best-effort attempt to focus the Review Queue Tab.

## Outcome

Extend the command sent through `herdr pane run` so a completed Lumen or Review Command first attempts to focus the Review Queue Tab and then attempts to close its created Herdr tab.

## Contract

For both fixed Lumen and the opaque configured Review Command, inject this sequence with both tab IDs shell-quoted:

```sh
LAUNCHED_COMMAND; herdr tab focus REVIEW_QUEUE_TAB_ID; herdr tab close CREATED_TAB_ID
```

- Run both cleanup calls after the launched process returns to the tab shell, whether it exits successfully, exits nonzero, or ends from a process signal that leaves the tab shell available.
- Attempt close even when the focus command fails. Both operations are best effort.
- Close only the Herdr tab created for that launch. Never close the saved Review Queue Tab.
- Keep the current immediate adapter result boundary. `review` reports only immediate `herdr tab create`, `herdr pane run`, and initial `herdr tab focus` failures; it does not wait for, observe, retry, or report the eventual cleanup results.
- A failed launch must not disable later Lumen or Review Command actions.

## Boundaries

- The installed `herdr` CLI remains the only Herdr boundary.
- Add no socket access, RPC, lifecycle state, subscriptions, listeners, snapshots, reconciliation, callbacks, retries, locks, or future-launch lockout.
- Do not make Review Queue focus restoration race-free and do not infer whether the user changed focus.
- Do not close active launched tabs when `review` itself exits. Self-closing applies only after that tab's launched command ends.
- Preserve the configured Review Command as opaque POSIX shell syntax and preserve all pull request environment variables.
- Update the Herdr execution contract, ADR/module documentation, and exact recording-fake tests.
- Add a patch changeset.

## Acceptance evidence

- Exact-call tests prove Lumen receives the launched command followed by shell-safe Review Queue focus and created-tab close commands in that order.
- Exact-call tests prove the opaque Review Command receives the same cleanup tail without changing its command or environment.
- Tests prove semicolon sequencing attempts close even if focus exits nonzero.
- Existing tests continue to prove immediate failures are actionable and a later launch remains permitted.

## Resolution

Implemented in PR #30 and squash-merged as `f730db758ce751c8f733091b781fd984aff775a8`.
