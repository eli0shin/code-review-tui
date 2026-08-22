# External process execution contract

## Decision

`review` uses the installed `herdr` CLI as its only Herdr boundary. The Review Queue stays in its saved Review Queue Tab. Each Lumen or Review Command action creates a dedicated Herdr tab in the same workspace. Herdr owns that tab's terminal, rendering, input, and process persistence.

`review` does not open a Herdr socket, implement the Herdr protocol, subscribe to events, or track command lifecycle.

## Required Herdr context

Require `HERDR_ENV=1` and nonblank `HERDR_WORKSPACE_ID` and `HERDR_TAB_ID` values injected by Herdr. The workspace ID identifies where new Herdr tabs are created. The tab ID is the saved Review Queue Tab for best-effort return focus.

Missing context stops TUI startup with an actionable instruction to run `review` inside Herdr. There is no Herdr connection to start, validate, monitor, reconnect, or shut down.

## Herdr CLI sequence

For each action, execute these installed CLI commands directly from `PATH` without a shell around the CLI process:

1. `herdr tab create --workspace … --cwd … --label … --no-focus` creates a shell-backed Herdr tab. Pass the child environment with explicit `--env KEY=VALUE` arguments.
2. Parse only `.result.tab.tab_id` and `.result.root_pane.pane_id` from the JSON response.
3. `herdr pane run PANE_ID COMMAND` runs the requested command. It then runs best-effort `herdr tab focus REVIEW_QUEUE_TAB_ID` and `herdr tab close CREATED_TAB_ID` commands in that tab's shell.
4. `herdr tab focus TAB_ID` focuses the new Herdr tab.

Return success after these immediate CLI calls succeed. Return the first immediate startup, exit, or JSON compatibility failure to the Review Queue page. Never retry an action automatically. A failed call does not disable a later user call.

Each action creates a new Herdr tab. Do not reuse tabs or infer Review Queue state from launched commands. There are no tool IDs, running or ended phases, notices, subscriptions, snapshots, indexes, or launch acknowledgements.

## Lumen

Before creating a Herdr tab, walk the directory from which `review` started and its ancestors for a `.git` or `.jj` marker. If none exists, report that `lumen diff` requires `review` to start inside a Git or Jujutsu repository.

Run this command in the new Herdr tab:

```text
lumen diff PULL_REQUEST_URL
```

Use the complete canonical pull request URL under the Cursor. Quote it as one shell argument. Use the startup working directory and inherited environment. Do not add Review Command variables.

## Review Command

Run the configured Review Command through this command in the new Herdr tab:

```text
/bin/sh -c CONFIGURED_REVIEW_COMMAND
```

The configured string is the one `-c` operand. Do not tokenize, rewrite, concatenate pull request values into, or separately evaluate it.

Use the startup working directory. Inherit the parent environment and replace the `REVIEW_PR_*` values defined by the [configuration contract](configuration-contract.md#opaque-review-command) for this Herdr tab only. Do not change the parent environment.

## Terminal ownership and return focus

After the final `herdr tab focus`, Herdr owns all terminal input and rendering for the launched command. OpenTUI continues to render only the Review Queue. Switching tabs uses Herdr controls.

The command sent by `herdr pane run` appends shell-safe `herdr tab focus` and `herdr tab close` commands. It quotes the saved Review Queue Tab ID and the created tab ID as separate shell arguments. Semicolons separate the launched command, focus command, and close command. Thus, the tab shell attempts focus after the launched process returns, even after a nonzero exit. It then attempts to close only the created tab, even if focus fails.

Both cleanup operations are best effort. `review` does not wait for or report their results, and it does not retry them. Review Queue focus can race with a user focus choice. The cleanup does not change the immediate adapter result boundary.

Opening or leaving a command does not refresh or change the Review Queue or Cursor.

## Exit

Quit, end-of-input, or a termination signal exits `review` immediately after normal presentation cleanup. There is no Herdr shutdown operation. Active Herdr tabs and their commands continue under Herdr ownership. A created tab closes itself only after its launched command returns to the tab shell.
