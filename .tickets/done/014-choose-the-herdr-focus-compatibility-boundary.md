---
Assigned-To: Pi
Tags:
  - grilling
  - hitl
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Question

Herdr v0.8.2 cannot safely distinguish automatic fallback focus after a Tool Tab exits from a delayed user focus change. Should `review` relax automatic return to the Review Queue so it can support Herdr v0.8.2, require and first add cursor-aware focus capabilities to Herdr, or revise the accepted tool-switching decision?

## Resolution

Keep automatic return to the Review Queue as best-effort behavior on Herdr v0.8.2. After ordinary tool-exit observation, attempt to focus the saved Review Queue pane. Do not promise race-free focus restoration, require new Herdr protocol capabilities, or chase event-ordering edge cases. Ratcheting review findings are a signal that the review is operating at the wrong abstraction level.

See [Use Herdr tabs for tool switching](../../docs/adr/0001-use-herdr-tabs-for-tool-switching.md).
