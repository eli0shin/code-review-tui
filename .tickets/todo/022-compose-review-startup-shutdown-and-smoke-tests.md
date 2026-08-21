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

Make the `review` executable start and stop correctly.

## Done when

- Startup loads configuration, connects to Herdr, renders the page, and starts the Review Queue query.
- A startup failure prints a useful error and exits non-zero.
- Quit, end-of-input, a closed Review Queue pane, and termination signals exit the application.
- Exit stops input, unmounts the page, disconnects from Herdr, and destroys the renderer.
- Exit does not close Herdr tabs that run Lumen or Review Commands.
- Native smoke tests cover successful startup, startup failure, and exit.
