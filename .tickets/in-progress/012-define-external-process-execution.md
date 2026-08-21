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
