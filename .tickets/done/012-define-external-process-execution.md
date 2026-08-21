---
Assigned-To: code-review-tui@012-define-external-process-execution
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Question

What process lifecycle contract launches the fixed `lumen diff` integration and opaque Review Commands, permits switching among concurrent interactive tools and the Review Queue, propagates terminal resize and input correctly, reports launch failures, and shuts down without orphaned processes?

## Resolution

Use Herdr v0.8.2 direct-process Tool Tabs for fixed Lumen and opaque Review Commands. Correlate and clean up only owned panes, keep launch uncertainty explicit, let Herdr own terminal input and resize, and make one best-effort `pane.focus` attempt for the saved Review Queue pane after an ordinary matching tool exit. Focus restoration is not race-free. See the [external process execution contract](../../docs/external-process-execution.md).

Merged by [Define external process execution](https://github.com/eli0shin/code-review-tui/pull/10) as commit `bb46f68`.
