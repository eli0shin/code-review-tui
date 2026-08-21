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

## Resolution

Use one deep `ReviewSession` application module with `GitHub` and `ToolTabs` ports. Keep strict XDG configuration, OpenTUI presentation, composition, and release operations outside that module. Verify each true external seam with contract adapters, verify complete Review Queue behavior through `ReviewSession`, and keep focus restoration at one best-effort Herdr request without race modeling. See the [Review CLI module architecture](../../docs/module-architecture.md).
