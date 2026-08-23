# Lumen annotation stdout integration

## Question

Can `review` use the annotations that Lumen writes to stdout when the user sends them, given that Lumen currently runs in a temporary Herdr tab?

## Findings

### Lumen already provides a clean annotation payload

The installed Lumen is 2.31.0. In that version, the user adds selection-, hunk-, or file-level annotations with `i`. `s` opens a confirmation modal. Confirming exits Lumen and writes all formatted annotations to stdout. Quitting or dismissing without send writes no annotation payload.[^lumen-readme]

When stdout is captured, Lumen opens `/dev/tty` for its TUI. Terminal control sequences continue to go to the visible terminal while stdout contains only the annotation payload.[^lumen-tui-writer] This means an ordinary shell redirection or pipe can capture annotations without breaking the interactive Lumen display.

The exported value is one Markdown-like text document, not a machine-readable annotation array. It can include a reference heading, then one block per annotation separated by `---`. A block identifies a file or a file and line range with `LEFT` or `RIGHT`, followed by the annotation body.[^lumen-export]

Example shape:

```text
# <reference>

**src/example.ts** lines 10-12 (RIGHT)

Explain why this branch is safe.

---

**README.md**

Document the new behavior.
```

### The current Herdr launch discards the useful distinction

`review` currently injects this shell line into the new Herdr pane:

```sh
lumen diff PULL_REQUEST_URL; herdr tab focus PULL_REQUEST_LIST_TAB; herdr tab close CREATED_TAB
```

`herdr pane run` submits a command to the pane's live terminal. It does not make that command's later stdout the stdout of the `herdr pane run` CLI process.[^herdr-pane-run] Therefore the adapter cannot read Lumen's eventual annotations from its existing `runHerdr()` result.

Because Lumen currently inherits the pane terminal as stdout, a sent payload is painted into that terminal. The following cleanup then focuses the Pull Request List tab and closes the Lumen tab, so the payload is lost to the application.

Capturing inside the injected shell command is sufficient:

```sh
annotations=$(mktemp)
lumen diff PULL_REQUEST_URL >"$annotations"
# A handoff can inspect the nonempty file here.
```

Lumen keeps using the visible pane through `/dev/tty`. The shell in that same pane can inspect or pass the captured file after Lumen exits.

### Capturing is easy; returning to the running application is not

The Pull Request List process and Lumen run in different Herdr panes. The current application has no return-value, event, or shared-state channel from a created Herdr tab. The Herdr adapter returns after it submits and focuses the created tab; it does not wait for Lumen's process exit. The original application therefore cannot directly prefill its in-memory Review Submission modal from Lumen stdout under the current boundary.

A design that returns the payload to that already-running modal needs a new coordination mechanism, such as a watched file, IPC, a Herdr output wait/read loop, or input injection. Each would expand the current Herdr contract and add lifecycle behavior that the architecture explicitly excludes.

## Feasible uses

### 1. Continue in the Lumen Herdr tab with a standalone Review Submission

Capture Lumen stdout to a temporary file. If the file is nonempty, run a `review` subcommand in the same Herdr tab that opens the existing Review Submission interaction with:

- the same pull request URL;
- the annotation export as the initial message;
- no preselected final decision beyond the normal safe default.

The user can edit the text and submit Comment, Approve, or Request Changes. After submit or cancel, the shell removes the file, focuses the Pull Request List tab, and closes the created tab.

This uses stdout without adding a return channel to the running Pull Request List. It keeps GitHub submission behind `review` and keeps explicit human control over the final decision. Its costs are a standalone composition entry point and delayed Pull Request List refresh or notice after submission.

### 2. Pass annotations to a configured handoff command

After Lumen exits with a nonempty payload, run a user-configured opaque shell command with the pull request metadata and an annotation-file environment variable. This can start an agent, copy the draft, create an issue, or run another local workflow.

This is flexible and keeps policy out of `review`, but it adds configuration and makes the normal outcome less clear. It also overlaps with the existing Review Command concept unless the handoff is defined narrowly.

### 3. Start the existing Review Command with annotations as input

Treat the annotations as the user's feedback to a coding agent: capture them, then start the existing Review Command in the same tab with an annotation file or prompt available. This follows Lumen's documented coding-agent loop.[^lumen-readme]

This is useful when the pull request authoring checkout is local and the goal is to fix code. It is less useful when `review` is reviewing someone else's remote pull request, and the existing Review Command contract does not currently accept dynamic stdin or an annotation payload.

### 4. Save a draft for later import in the Pull Request List process

Write the payload to XDG state and let the running application discover it later. This preserves the original modal location, but it introduces cross-pane persistence, discovery, identity, cleanup, stale-draft, and concurrency rules. It conflicts with the current memory-only Review Submission and no-coordination design. This is the highest-complexity option.

### 5. Submit directly from the shell

A shell can send the captured text directly with `gh pr review`. This is mechanically small but bypasses the Review Submission editor, explicit decision controls, validation, preserved failure state, and final human confirmation. It should not be the default flow.

## Constraints on inline GitHub comments

Lumen's export contains useful file and line labels, but it is formatted for humans. It is not a stable JSON schema and does not contain the complete GitHub review-comment request data. Parsing it into GitHub inline comments would couple `review` to presentation text and would need line mapping, commit identity, side/range validation, outdated-diff handling, and partial-failure behavior. The safe direct use is a top-level Review Submission message unless Lumen adds a supported machine-readable export.

## Accepted direction

Lumen comments are input that the user can choose to load during a later, separate code-review session. They are not a Review Submission body, are not automatically injected into a Review Command, and are not parsed into GitHub inline comments.

Capture Lumen stdout inside its existing Herdr tab. Write it first to a temporary file. When Lumen exits successfully with nonempty stdout, replace this deterministic file:

```text
/tmp/review/lumen/<org>/<repo>/<pull-request-number>.txt
```

The file contains exact Lumen stdout. A normal Lumen exit without send leaves the prior file unchanged. Keep the existing best-effort focus and close behavior. Add no return channel, application state, automatic Review Command handoff, or custom environment variable.

Add `review skill install`. It always overwrites `~/.agents/skills/review-comments/SKILL.md` with a user-invoked `review-comments` skill. The skill only instructs the agent:

> Read the review comments for the pull request under review from `/tmp/review/lumen/<org>/<repo>/<pull-request-number>.txt`.

The skill assigns no meaning or required action to the loaded comments.

## Sources

[^lumen-readme]: Lumen 2.31.0 README, “Selection & Annotations” and “Coding Agent Integrations”: https://github.com/jnsahaj/lumen/blob/v2.31.0/README.md#selection--annotations and https://github.com/jnsahaj/lumen/blob/v2.31.0/README.md#coding-agent-integrations-

[^lumen-tui-writer]: Lumen 2.31.0 source, `open_tui_writer` and send-on-exit handling: https://github.com/jnsahaj/lumen/blob/v2.31.0/src/command/diff/app.rs#L17-L36 and https://github.com/jnsahaj/lumen/blob/v2.31.0/src/command/diff/app.rs#L2204-L2218

[^lumen-export]: Lumen 2.31.0 source, `format_annotations_for_export`: https://github.com/jnsahaj/lumen/blob/v2.31.0/src/command/diff/state.rs#L907-L953

[^herdr-pane-run]: Herdr CLI reference, “Send input”: https://herdr.dev/docs/cli-reference/#send-input
