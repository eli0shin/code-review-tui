---
Assigned-To: code-review-tui@017-implement-review-session-queue-and-details
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Goal

Implement the `ReviewSession` queue, selection, details, refresh, and subscription behavior through the approved `GitHub` port.

## Done when

- Initial load and refresh keep the prior queue visible until atomic replacement.
- Selection is preserved by pull request URL, and stale detail results cannot replace current details.
- Refresh requests coalesce according to the accepted contract, and failures preserve valid prior data.
- Controllable in-memory adapter tests prove the complete queue and details scenarios through the public session interface.
