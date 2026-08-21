---
Assigned-To: code-review-tui@016-implement-github-cli-data-adapter
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Goal

Implement shared pull request domain values and the `GitHub` port and CLI adapter in `docs/module-architecture.md` and `docs/research/github-cli-integration-contract.md`.

## Done when

- Queue, details, and Review Submission use exact direct `gh` argv and stdin contracts without a shell.
- All returned JSON has complete shape validation before conversion to domain values.
- Operation-specific startup, exit, interruption, malformed-data, and incompatible-data failures preserve diagnostics.
- Recording-fake `gh` contract tests cover every operation and failure class.

## Resolution

Implemented shared pull request domain values and a direct-process `GitHub` CLI adapter for queue, details, and Review Submission. The adapter validates complete JSON shapes, preserves operation diagnostics, writes exact Review Submission stdin, and delegates host and authentication to `gh`. Recording-fake process tests cover each operation and failure class.

Merged by [Implement GitHub CLI data adapter](https://github.com/eli0shin/code-review-tui/pull/13) as commit `36fa1f1`.
