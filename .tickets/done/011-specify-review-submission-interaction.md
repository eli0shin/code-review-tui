---
Assigned-To: code-review-tui@011-specify-review-submission-interaction
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Question

What compact interaction lets the user write a multiline review message, choose comment, approve, or request changes, cancel safely, submit through GitHub CLI, and understand success or failure without supporting inline comments?

## Resolution

Use a compact modal with a multiline message and explicit comment, approve, or request-changes decisions. Validate decision-specific body rules, confirm discard only for changed drafts, lock while submitting, preserve drafts on failure, and refresh the Review Queue after confirmed success. See the [Review Submission interaction contract](../../docs/review-submission-interaction.md).

Merged by [Specify the Review Submission interaction](https://github.com/eli0shin/code-review-tui/pull/9) as commit `c99d31c`.
