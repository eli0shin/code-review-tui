---
Assigned-To: code-review-tui@006-bootstrap-the-application-from-the-tickets-project-shell
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Question

Copy the sibling `tickets` repository project shell into this repository, rename it for the `review` executable, remove Tickets domain internals, add the minimal OpenTUI React entry point, and preserve its packaging, installer, updater, changesets, checks, tests, and release workflows. What exact working baseline results?

## Resolution

The repository now builds the `review` OpenTUI React executable and preserves the Tickets-derived Bun, TypeScript, installer, updater, Changesets, test, CI, and four-platform release shell. The baseline includes focused application, configuration, installation, update, and release-workflow coverage.

Merged by [Bootstrap the review application shell](https://github.com/eli0shin/code-review-tui/pull/5) as commit `2ad010a`.
