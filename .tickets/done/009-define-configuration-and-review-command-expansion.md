---
Assigned-To: code-review-tui@009-define-configuration-and-review-command-expansion
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Question

What is the exact XDG configuration schema for the GitHub CLI search, Review Command, and key bindings, and how are selected pull request values interpolated into the opaque Review Command without changing its shell semantics?

## Resolution

Use one strict XDG JSON configuration for the GitHub search, opaque Review Command, key bindings, and updater settings. Tokenize the GitHub query without shell evaluation. Expose selected pull request values as child-only environment variables so the Review Command keeps native POSIX shell expansion instead of application text substitution. See the [configuration contract](../../docs/configuration-contract.md) and [JSON Schema](../../docs/config.schema.json).

Merged by [Define configuration and Review Command expansion](https://github.com/eli0shin/code-review-tui/pull/8) as commit `2c060f1`.
