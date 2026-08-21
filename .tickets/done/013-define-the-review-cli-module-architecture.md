---
Assigned-To: code-review-tui@013-define-the-review-cli-module-architecture
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Question

What deep module boundaries and end-to-end contracts isolate GitHub CLI data, XDG configuration, Review Command expansion, interactive process control, OpenTUI presentation, and release infrastructure well enough to make the complete CLI implementation and tests straightforward?

## Superseded resolution

The application-state module selected by this decision was rejected wholesale. The current architecture keeps `GitHub` and `ToolTabs` as deep external ports and puts ordinary Review Queue state and loading directly in the OpenTUI React page. See the [Review CLI module architecture](../../docs/module-architecture.md).

The original decision was merged by [Define review CLI module architecture](https://github.com/eli0shin/code-review-tui/pull/11) as commit `89176e3` and superseded by ticket 024.
