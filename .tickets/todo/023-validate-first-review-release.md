---
Assigned-To:
Tags:
  - task
  - hitl
Parent: 001-build-the-review-cli
Blocked-By:
  - 022-compose-review-startup-shutdown-and-smoke-tests
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

## Release gate

Do not inspect, update, publish, or merge a release pull request until the user accepts the finished CLI and explicitly authorizes release work.
