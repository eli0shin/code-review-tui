---
Assigned-To:
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
