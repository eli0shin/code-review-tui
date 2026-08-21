---
Assigned-To: code-review-tui@002-research-the-lumen-diff-launch-contract
Tags:
  - research
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Question

How does `lumen diff` identify and open a pull request across repositories without a local checkout, what current working directory or repository context does it require, and how does its interactive process return control to a parent terminal application?

## Resolution

Use a full pull request URL with `lumen diff`. Lumen can load a cross-repository pull request without checking out that repository, but it must start inside some Git or Jujutsu repository. Run it as a foreground interactive child and restore parent terminal state after it exits. See the [Lumen launch contract](../../research/lumen-diff-launch-contract.md).

Merged by [Document the Lumen diff launch contract](https://github.com/eli0shin/code-review-tui/pull/1) as commit `afc293f`.
