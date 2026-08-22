---
Assigned-To:
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Goal

Make the `review` executable start and stop correctly.

## Done when

- Startup loads configuration, renders the page, and starts the Review Queue query.
- A startup failure prints a useful error and exits non-zero.
- Quit, end-of-input, and termination signals exit the application.
- Exit stops input, unmounts the page, and destroys the renderer.
- Exit does not close Herdr tabs that run Lumen or Review Commands.
- Native smoke tests cover successful startup, startup failure, and exit.
