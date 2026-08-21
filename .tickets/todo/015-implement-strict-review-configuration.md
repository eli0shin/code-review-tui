---
Assigned-To:
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Goal

Implement the strict XDG configuration module in `docs/module-architecture.md` and `docs/configuration-and-review-command-expansion.md`.

## Done when

- The complete TUI configuration has strict field, type, key-binding, and collision validation.
- Search tokenization and opaque Review Command preservation match the accepted contract.
- Updater-only reads remain tolerant and independent from required TUI fields.
- Temporary XDG and HOME contract tests cover valid input, defaults, and each failure class.
