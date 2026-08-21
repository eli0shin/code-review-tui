---
Assigned-To:
Tags:
  - wayfinder-map
Parent:
Blocked-By: []
---

## Destination

Build the complete `review` CLI as scoped: a personal OpenTUI React application that shows the configured GitHub CLI pull request search, opens the selected diff in `lumen diff`, runs a configurable Review Command, and submits comment, approve, or request-changes reviews.

## Notes

- This map explicitly carries execution through the complete working CLI. Do not stop at a specification.
- Use the language in [`CONTEXT.md`](../../CONTEXT.md).
- Use TypeScript, Bun, and OpenTUI with React.
- Copy the project shell, packaging, install, update, CI, changeset, and release design from the sibling `tickets` repository. Rename only what belongs to this application. Consult `repos` for matching established patterns when useful.
- Delegate all GitHub search, host, authentication, and account behavior to the installed `gh` CLI.
- Lumen is a fixed `lumen diff` integration. It is not configurable.
- The Review Command is one configurable shell command, including its program, flags, and initial input. Do not hard-code Pi.
- The Review Queue contains only current GitHub search results. Do not add local workflow state.
- Use one XDG config file for the GitHub search, Review Command, and key bindings.
- Every child is tagged `afk` or `hitl`. AFK tickets can run without the user. HITL tickets require live user decisions or prototype feedback.
- Invoke the skill that matches each ticket type. Use `domain-modeling` when a decision changes project language, `codebase-design` for module boundaries, and `tdd` for implementation.

## Decisions so far

- [Research the Lumen diff launch contract](../done/002-research-the-lumen-diff-launch-contract.md) — Launch `lumen diff` with a full PR URL from any Git or Jujutsu repository and treat it as a foreground interactive child.
- [Research OpenTUI control of interactive child terminals](../done/003-research-opentui-control-of-interactive-child-terminals.md) — OpenTUI can retain compatible tools in embedded PTYs, while Lumen keeps physical-terminal foreground handoff.
- [Research Herdr tabs and cabs for tool switching](../done/004-research-herdr-tabs-and-cabs-for-tool-switching.md) — Herdr provides persistent tabs, direct process launch, focus, layouts, and lifecycle events, but no cab or general return-to-caller abstraction.
- [Research the GitHub CLI integration contract](../done/005-research-the-github-cli-integration-contract.md) — Build the queue, details, and submission boundary with `gh search prs`, `gh pr view`, and `gh pr review`, while delegating host and authentication to `gh`.
- [Bootstrap the application from the tickets project shell](../done/006-bootstrap-the-application-from-the-tickets-project-shell.md) — The `review` executable now has the Tickets-derived Bun, OpenTUI React, installer, updater, test, CI, Changesets, and cross-platform release shell.
- [Prototype the Review Queue interaction](../done/007-prototype-the-review-queue-interaction.md) — Use a borderless GitHub-style list with terminal-derived semantic colors and a subtle full-row selection surface that preserves row colors.
- [Define configuration and Review Command expansion](../done/009-define-configuration-and-review-command-expansion.md) — Use one strict XDG JSON config, tokenize search without shell evaluation, and expose pull request values to the opaque Review Command through child environment variables.
- [Define GitHub data refresh and failure behavior](../done/010-define-github-data-refresh-and-failure-behavior.md) — Replace queue data atomically, preserve selection by PR URL, refresh manually or after submission, and show operation-specific `gh` failures without local workflow state.
- [Specify Review Submission interaction](../done/011-specify-review-submission-interaction.md) — Compose Review Submissions in a compact multiline modal with explicit decisions, safe discard, in-flight locking, draft-preserving retry, and post-success queue refresh.
- [Choose the tool switching model](../done/008-choose-the-tool-switching-model.md) — Require Herdr, keep the queue in its saved tab, and run Lumen and Review Commands in dedicated Tool Tabs that return focus on exit.
- [Choose the Herdr focus compatibility boundary](../done/014-choose-the-herdr-focus-compatibility-boundary.md) — Keep automatic queue focus restoration as a best-effort Herdr v0.8.2 behavior without race-free guarantees or new protocol requirements.
- [Define external process execution](../done/012-define-external-process-execution.md) — Use Herdr v0.8.2 direct-process Tool Tabs, pane-only ownership and cleanup, explicit launch uncertainty, and one best-effort queue-pane focus attempt after ordinary tool exit.

## Not yet specified

- Implementation slices, end-to-end acceptance scenarios, and test boundaries will become precise after the interaction and integration contracts are settled.
- Installation documentation and release validation will become precise after the executable architecture is settled.

## Out of scope

- Inline pull request comments.
- Local checkout, worktree, and `repos` runtime integration.
- Durable or transient tracking of Lumen, agent-review, or readiness state in the Review Queue.
- Configuration synchronization, profiles, or application-managed GitHub credentials and hosts.
- A configurable replacement for the fixed `lumen diff` integration.
