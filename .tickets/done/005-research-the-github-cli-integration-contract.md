---
Assigned-To: code-review-tui@005-research-the-github-cli-integration-contract
Tags:
  - research
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Question

Which `gh` commands, search syntax, JSON fields, pagination behavior, and review APIs can implement the cross-repository Review Queue, pull request details, and Review Submission while leaving host, authentication, and account selection entirely to GitHub CLI configuration?

## Resolution

Use `gh search prs` for the Review Queue, `gh pr view` for selected pull request details, and non-interactive `gh pr review` commands for Review Submission. Preserve repository identity in cross-repository results, handle command limits explicitly, and delegate host, authentication, and account selection to `gh`. See the [GitHub CLI integration contract](../../docs/research/github-cli-integration-contract.md).

Merged by [Define the GitHub CLI integration contract](https://github.com/eli0shin/code-review-tui/pull/2) as commit `f854a52`.
