---
Assigned-To: code-review-tui@023-validate-first-review-release
Tags:
  - task
  - hitl
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Goal

Validate the finished CLI and its documentation.

## Done when

- The complete CLI is exercised as a user against real `gh`, Lumen, and Herdr installations.
- The four supported binaries build and start.
- Installer and updater success and failure paths are checked.
- User documentation covers configuration, requirements, keys, Review Commands, Review Submissions, installation, and updates.
- Generated files and binaries contain only intended changes.
- The user accepts the finished CLI.

## Release authorization

The user authorized completion and publication on 2026-08-22. Validate the finished CLI and generated release output before publishing.

## Resolution

Validated in PR #23, merged as commit `a4cfed7545c2bad575a89c4e006109d5a7762ad2`. Published [v0.2.0](https://github.com/eli0shin/code-review-tui/releases/tag/v0.2.0) with the four intended native binaries.
