---
Assigned-To: code-review-tui@010-define-github-data-refresh-and-failure-behavior
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Question

How does the application load and refresh the Review Queue, preserve or reset selection, reflect successful Review Submissions, handle pagination, and present GitHub CLI failures without adding non-GitHub workflow state?

## Answer

Use the atomic loading, URL-based selection, submission refresh, pagination, and failure contract in [`docs/github-data-refresh-and-failure-behavior.md`](../../docs/github-data-refresh-and-failure-behavior.md).
