---
Assigned-To:
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By:
  - 021-build-opentui-review-queue-and-submission
---

## Goal

Compose the complete TUI runtime and lifecycle in `src/cli.tsx` and `src/runtime.ts`, then add native executable smoke tests.

## Done when

- Startup routes configuration values to their owning modules and fails before starting later dependencies.
- Valid startup mounts OpenTUI and starts the initial Review Queue load.
- Quit, end-of-input, pane loss, and signals coordinate direct Tool Tab shutdown, presentation unmount, and renderer destruction.
- Presentation unmount clears its page-owned refresh timer.
- Native executable smoke tests cover critical startup, command independence, and termination paths without duplicating OpenTUI page tests.
