---
Assigned-To: code-review-tui@015-implement-strict-review-configuration
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Goal

Implement the strict XDG configuration module in `docs/module-architecture.md` and `docs/configuration-contract.md`.

## Done when

- The complete TUI configuration has strict field, type, key-binding, and collision validation.
- Search tokenization and opaque Review Command preservation match the accepted contract.
- Updater-only reads remain tolerant and independent from required TUI fields.
- Temporary XDG and HOME contract tests cover valid input, defaults, and each failure class.

## Resolution

Implemented strict XDG configuration loading, search tokenization without shell evaluation, exact opaque Review Command preservation, effective key-binding validation against conventional terminal events, and independent updater-only reads with fail-safe invalid-input behavior. Temporary filesystem contract tests cover paths, defaults, validation, collisions, and updater behavior.

Merged by [Implement strict Review configuration](https://github.com/eli0shin/code-review-tui/pull/12) as commit `e5504de`.
