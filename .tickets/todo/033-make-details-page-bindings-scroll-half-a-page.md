---
Assigned-To:
Tags:
  - bug
  - ui
Parent:
Blocked-By: []
---

## Problem

The full-screen pull request details modal moves slightly more than one visible page when the effective `pagePrevious` binding defaults to `Ctrl+U`. This conflicts with the conventional half-page behavior of `Ctrl+U` and makes reading position difficult to follow. The paired `Ctrl+D` behavior must remain symmetric.

## Outcome

Make the effective `pagePrevious` and `pageNext` actions scroll the details modal by half of the current visible scroll viewport, up or down respectively.

## Contract

- `Ctrl+U`, through the configurable `pagePrevious` action, moves up by half of the currently visible details viewport.
- `Ctrl+D`, through the configurable `pageNext` action, moves down by the same half-viewport amount.
- Derive the distance from the actual current scroll viewport rather than terminal height or document length.
- Use a deterministic integer rule for odd viewport heights, move at least one rendered line when scrolling is possible, and keep the two directions symmetric.
- Clamp at the start and end of the scrolling buffer without overshoot.
- Preserve line scrolling, start/end scrolling, configurable bindings, modal target, Cursor restoration, content loading, and input ownership.
- Do not rename configuration actions or add migration behavior.
- Update user-facing details navigation documentation so `Ctrl+U` and `Ctrl+D` are described as half-page movement.
- Add a patch changeset.

## Acceptance evidence

- OpenTUI coverage uses a long details document and proves both actions move by exactly the specified half-viewport distance.
- Coverage includes an odd viewport height, minimum movement, repeated movement, and clamping at both boundaries.
- Existing configurable-binding and full-screen details modal coverage continues to pass.
