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

## Not yet specified

- Implementation slices, end-to-end acceptance scenarios, and test boundaries will become precise after the interaction and integration contracts are settled.
- Installation documentation and release validation will become precise after the executable architecture is settled.

## Out of scope

- Inline pull request comments.
- Local checkout, worktree, and `repos` runtime integration.
- Durable or transient tracking of Lumen, agent-review, or readiness state in the Review Queue.
- Configuration synchronization, profiles, or application-managed GitHub credentials and hosts.
- A configurable replacement for the fixed `lumen diff` integration.
