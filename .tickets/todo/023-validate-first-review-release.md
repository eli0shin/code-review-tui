---
Assigned-To:
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By:
  - 022-compose-review-startup-shutdown-and-smoke-tests
---

## Goal

Validate and document the first complete Review CLI release.

## Done when

- Installer, updater, and workflow contracts agree on the four artifact names and the completed `src/cli.tsx` composition root.
- The native executable is tested on supported target builds, including installer and update failure paths.
- User documentation covers configuration, required `gh`, Lumen and Herdr context, Review Commands, key bindings, submission, installation, and update behavior.
- Generated release outputs and binary assets are inspected and contain only intended changes.
