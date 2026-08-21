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

## Resolution

Use atomic queue replacement, pull request URL identity, explicit selection invalidation, manual refresh plus refresh after successful Review Submission, GitHub-owned pagination up to the search limit, and operation-specific GitHub CLI failures. Do not add optimistic membership or local workflow state. See the [GitHub data refresh and failure contract](../../docs/github-data-refresh-and-failure-behavior.md).

Merged by [Define GitHub data refresh and failure behavior](https://github.com/eli0shin/code-review-tui/pull/6) as commit `4f67310`.
