---
Assigned-To:
Tags:
  - implementation
  - ui
Parent:
Blocked-By: []
---

## Problem

The Review Queue reserves only six rows at the bottom of the screen for pull request details. Long descriptions are unreadable, most of the screen is empty, and the user cannot inspect the complete GitHub review conversation, reviewers, or checks. The rejected split-screen prototype must not return.

## Outcome

Replace the fixed details pane with one full-screen pull request details modal. The modal is a single borderless scrolling buffer painted over the Review Queue. It gives the pull request description and complete review context the full terminal instead of adding another compact or split pane.

## Interaction contract

- Remove the existing six-row details pane. When no modal is open, the Review Queue uses all available vertical space.
- `Enter` opens details for the pull request under the Cursor. Capture that pull request URL as the modal target until the modal closes.
- Only `d` opens Lumen by default. `Enter` must not open Lumen.
- Start the complete details load when the modal opens. Refetch on every opening. Cached content can remain visible while a new load runs.
- The modal owns input. Review Queue actions, including Lumen, the Review Command, and Review Submission, do not run while it is open.
- Paint the header, all content sections, concise failures, and final key help in one full-screen scrolling buffer. Do not add a fixed header, fixed footer, nested scroll area, compact inner panel, or split screen.
- Scroll one rendered line with the effective `selectPrevious` and `selectNext` bindings. Scroll by page, start, and end with their effective bindings. Refresh all modal data with the effective `refresh` binding. Close with the effective `quit` binding and return to the unchanged Review Queue and Cursor.
- Keep modal navigation configurable. Add these actions and defaults:
  - `openDetails`: `enter`
  - `pagePrevious`: `ctrl+u`
  - `pageNext`: `ctrl+d`
  - `scrollStart`: `g`, `home`
  - `scrollEnd`: `shift+g`, `end`
  - `showErrors`: `e`
- Change the `openDiff` default to only `d` and the `quit` default to `q`, `escape`.
- Existing action override and collision validation rules apply normally. Add no legacy compatibility, migration, precedence, rewriting, or special handling for configurations that still assign `enter` to `openDiff`.

## Content contract

Render these sections in order:

1. Pull request identity and metadata: repository, number, title, author, state, refs, labels, and change counts.
2. Review decision, requested reviewers, and submitted reviewers with their states.
3. Checks, showing only each check name and state.
4. Pull request description.
5. Conversation containing every issue comment, submitted review, and inline review comment in chronological order.

For each conversation entry, show its source, author, timestamp, state when applicable, and exact body. For inline review comments also show file path, line or range, reply relationship, and resolved or outdated state. Include reviews with empty bodies so their review state remains visible. Load complete paginated results rather than silently truncating discussion.

Treat all GitHub bodies as plain text. Preserve their line structure and wrap lines to the terminal width. Do not parse, render, strip, or restyle Markdown syntax.

## Loading and failure contract

- Load independent GitHub sources independently so one failure does not hide successful sections.
- Merge all successful conversation sources chronologically even when another conversation source fails.
- Put only a concise unavailable marker in each affected section. Do not print complete process diagnostics inline.
- The effective `showErrors` binding opens the existing bounded error surface with the complete unchanged diagnostics for all failed detail sources. Closing that surface returns to the same modal and scroll position.
- The effective `refresh` binding reloads all modal sources together. Do not add automatic retries or separate retry controls for each section.

## Boundaries

- GitHub CLI remains the only GitHub process boundary. Preserve host and authentication delegation to `gh` and validate all returned data.
- React Query owns remote detail data, cancellation, status, caching, and refetching. The page owns only temporary modal target and presentation state.
- Do not create selection identity, stores, controllers, event buses, or lifecycle machinery.
- Update the schema, generated default configuration, configuration contract, GitHub integration contract, module documentation, README, adapter tests, and native/page coverage.
- Add a patch changeset.

## Acceptance evidence

- Tests prove `Enter` opens the full-screen details modal and `d` alone opens Lumen.
- Tests prove the old details pane is absent and the Review Queue reclaims its space.
- Tests prove long plain-text descriptions and complete paginated conversations are reachable by configurable line, page, start, and end scrolling.
- Tests prove reviewers, check names/states, issue comments, reviews, inline context, and resolved/outdated thread state are visible.
- Tests prove one source failure leaves successful sections visible, concise markers remain inline, full diagnostics remain reachable, and refresh retries all sources.
- Tests prove the modal captures its target, owns input, refetches on every opening, and returns to the unchanged Cursor.

## Local follow-through

After this change lands, the orchestrator must update `/home/elioshinsky/.config/review/config.json` to the new explicit bindings. This is a one-time personal configuration edit, not application migration behavior. The implementation worker must not modify files outside its worktree.
