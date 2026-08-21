---
Assigned-To: Pi
Tags:
  - prototype
  - hitl
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Question

After comparing the researched capabilities in a rough working prototype, should `review` switch among the Review Queue, `lumen diff`, and one or more Review Command processes through OpenTUI terminal control, Herdr, or a smaller combination of both?

## Resolution

Use full Herdr integration. Keep the Review Queue in its saved Herdr tab and launch Lumen or a Review Command in dedicated Tool Tabs. Herdr owns terminal input, rendering, persistence, and switching; `review` correlates tool exit events and restores the Review Queue Tab. Embedded OpenTUI tools were rejected because the host intercepts nested TUI key bindings, and full handoff was rejected because it cannot keep concurrent surfaces available.

See [Use Herdr tabs for tool switching](../../docs/adr/0001-use-herdr-tabs-for-tool-switching.md). The three working alternatives are preserved in [prototype commit `52c9f0b`](https://github.com/eli0shin/code-review-tui/commit/52c9f0bc292d3d83e896ae5d63e0c75b07a87237).
