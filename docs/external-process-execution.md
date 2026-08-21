# External process execution contract

## Decision

`review` requires a compatible Herdr session. The Review Queue stays in the Herdr tab that started `review`. Each Lumen or Review Command process runs directly in a new, dedicated Tool Tab in the same workspace. Herdr owns the Tool Tab pseudo-terminal (PTY), rendering, input, resize delivery, and process persistence. `review` owns launch correlation, lifecycle notices, return focus, and shutdown of every Tool Tab that it creates.

This contract replaces physical-terminal handoff and OpenTUI-embedded terminals for these tools. It implements the accepted [Herdr tab decision](adr/0001-use-herdr-tabs-for-tool-switching.md). It does not add a terminal emulator or multiplexer to `review`.

## Required Herdr context

At TUI startup, require all of these conditions:

- `HERDR_ENV=1`;
- nonblank `HERDR_SOCKET_PATH`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, and `HERDR_PANE_ID` values injected by Herdr;
- a reachable Herdr socket whose protocol supports `session.snapshot`, `layout.apply`, `tab.focus`, `tab.close`, and event subscriptions; and
- a snapshot in which the supplied workspace, Review Queue Tab, and Review Queue pane exist and have the stated relationship.

The initial `HERDR_TAB_ID` is the saved Review Queue Tab for the complete process lifetime. Do not derive the return target from whichever tab is focused later. Create Tool Tabs only in the saved workspace.

Failure of any startup condition stops TUI startup. Identify Herdr, the missing or incompatible condition, and the action to start or update Herdr and run `review` inside a Herdr pane. Do not silently fall back to an ordinary terminal, physical-terminal handoff, or an OpenTUI embedded PTY.

Use one long-lived socket client for requests and one event subscription. Subscribe before the first launch so that a fast child cannot exit before observation starts. Request IDs correlate replies. Resource IDs from Herdr correlate later events.

## Tool launch model

A queue action starts one launch operation for the selected pull request. Generate a unique, in-memory tool ID before sending the request. The launch has these states:

1. **launching**: subscribed, but no confirmed Tool Tab exists;
2. **running**: Herdr returned the Tool Tab and pane IDs;
3. **closing**: `review` requested closure and is waiting for Herdr confirmation; and
4. **ended**: no owned pane or Tool Tab remains.

Use `layout.apply` to create one focused tab with one direct argv-backed pane. Set a concise tab and pane label that distinguishes Lumen from a Review Command and includes the pull request repository, number, and unique tool ID. Also put that ID in the pane environment as `REVIEW_TOOL_ID`; it is lifecycle correlation data, not durable Review Queue state.

Buffer lifecycle events received while a matching `layout.apply` request is unresolved. After the response supplies the pane and tab IDs, apply buffered matching events before reporting the tool as running. Ignore session-wide events for resources that `review` does not own.

Each action creates a new Tool Tab. A pull request can have Lumen, a Review Command, or several instances of either running concurrently. Do not reuse a shell tab, replace an existing Tool Tab, impose one-tool-at-a-time behavior, or infer Review Queue state from a running or completed tool.

### Lumen

Launch Lumen without a shell:

```text
["lumen", "diff", PULL_REQUEST_URL]
```

Use the selected Review Queue item's complete canonical URL. Do not use a pull request number, `--origin`, `--detect-pr`, shell text, or a target checkout.

Use the directory from which `review` started as the child working directory. Before creating a Tool Tab, walk that directory and its ancestors for a Git or Jujutsu repository marker. If none exists, do not launch. Report that `lumen diff` requires `review` to start inside any Git or Jujutsu repository; the repository does not have to match the pull request. This preserves the accepted [Lumen launch contract](../research/lumen-diff-launch-contract.md) without creating or selecting application-owned checkouts.

Lumen inherits the parent environment. `review` does not add the Review Command pull request variables to Lumen.

### Review Command

Launch the Review Command as exactly:

```text
["/bin/sh", "-c", CONFIGURED_REVIEW_COMMAND]
```

The configured string is the one command operand. Do not tokenize, rewrite, concatenate pull request values into, or separately evaluate any part of it.

Use the directory from which `review` started as the shell working directory. Inherit the parent environment and replace the pull request variables defined by the [configuration contract](configuration-contract.md#opaque-review-command) for this child only. Also add `REVIEW_TOOL_ID`. Herdr then adds its authoritative managed variables for the Tool Tab. Do not change the parent environment.

A shell operator, redirection, pipeline, expansion, or background process has its normal POSIX shell meaning. A process that deliberately daemonizes and detaches from the Tool Tab's terminal and process group leaves the lifecycle that this application owns; `review` cannot adopt or terminate it.

## Terminal ownership, input, and resize

After `layout.apply` focuses a Tool Tab, Herdr is the only owner of that tool's terminal path:

- Herdr sends keyboard, paste, mouse, and terminal focus input to the focused Tool Tab.
- Herdr resizes the Tool Tab PTY and delivers the resulting terminal resize behavior.
- Herdr retains the PTY screen and process while another tab is focused.
- OpenTUI continues to render only the Review Queue Tab. It does not read, forward, filter, or reserve input for a Tool Tab.

Queue key bindings apply only when the Review Queue pane has focus. Tool input must not pass through OpenTUI first. Switching among the Review Queue and Tool Tabs uses Herdr's own tab controls. `review` does not synthesize switch keys or suspend a background tool.

A Tool Tab can continue to run and produce output while unfocused. Returning to the Review Queue does not stop it. Opening or leaving a tool does not refresh the Review Queue.

## Completion and return focus

Observe `pane.exited`, `pane.closed`, `pane.moved`, `pane.focused`, `tab.closed`, and `tab.focused` events. Track a moved owned pane by the new resource IDs from Herdr. Track pane focus separately from tab focus so that an unrelated pane added to a Tool Tab does not count as the tool owning focus. Treat either confirmed process exit or external closure of its pane as tool completion. Resource closure is idempotent: duplicate or reordered exit and close events produce one completion.

When a direct process exits, Herdr removes its pane and removes the Tool Tab when it is empty. `review` must not close or modify a tab that now contains a pane it does not own.

Focus the saved Review Queue Tab after completion only when the ending tool owned focus immediately before its exit. If the user had already focused the Review Queue, another Tool Tab, or another Herdr surface, preserve that choice. A background tool exit must not steal focus from an active tool.

If the Review Queue Tab still exists but focus restoration fails, show a recoverable Herdr control failure. If that tab or its workspace no longer exists, stop new launches and start application shutdown because there is no valid Review Queue return target.

Herdr's accepted `pane.exited` event does not include the direct process exit status or terminating signal. Treat every observed exit as completion and do not claim whether the tool succeeded. The Tool Tab is the tool's output surface while it runs. Closure requested by `review` during shutdown is also completion, not a tool failure.

An exit does not change Review Queue membership, add review progress state, or cause an automatic refresh.

## Launch and control failures

Keep launch failures at the queue action boundary. Preserve the Review Queue and selected pull request and permit the user to retry the action. Never retry a tool launch automatically because a Review Command can have non-idempotent effects.

Distinguish these cases:

- **Precondition failure:** no selected pull request, no repository working directory for Lumen, or invalid saved Herdr context. Do not send `layout.apply`.
- **Could not start:** Herdr rejects tab or direct process creation. Name the executable, pull request, Herdr error code, and operating-system error when available.
- **Control failure:** focus, close, subscription, or socket operations fail after creation. Keep ownership of any known Tool Tab until Herdr confirms that it ended.

Once Herdr starts the direct process, `review` cannot distinguish a successful exit, nonzero exit, or terminating signal. In particular, `/bin/sh` can start and then return status 126 or 127 for a Review Command, but Herdr does not expose that status. Do not misreport this completion as a launch failure or success.

A failed `layout.apply` response means no Tool Tab exists only when Herdr says the request made no change. A connection loss or timeout has an unknown result. Reconnect, take a fresh session snapshot, and reconcile the request by its known resource IDs and unique tool label before permitting a retry. If a Tool Tab might exist, treat it as owned and offer cleanup; do not issue a second launch that can duplicate it.

If the event subscription disconnects, mark tool lifecycle as degraded, disable new launches, reconnect, and take a fresh snapshot before resuming. Existing tools continue under Herdr. Reconcile each owned resource as running or ended and process focus restoration only from authoritative snapshot and later event state. Do not infer completion only from socket loss.

## Shutdown

One asynchronous shutdown coordinator owns quit, end-of-input, Review Queue Tab closure, `SIGINT`, and `SIGTERM`. The first request makes shutdown irreversible:

1. stop accepting queue actions and new launches;
2. settle every unresolved launch through response or snapshot reconciliation;
3. request closure of every pane or Tool Tab still owned by `review`;
4. wait for matching close or exit confirmation;
5. close the event subscription and control socket;
6. unmount the React root and destroy the OpenTUI renderer; and
7. exit with the reason's appropriate status.

Close tools concurrently, but correlate every result separately. Closing an unmodified dedicated Tool Tab terminates its direct process and normal descendants through Herdr's pane lifecycle. If a user changed a Tool Tab to contain unrelated panes, close only the owned process pane. Never close the Review Queue Tab through the cleanup path.

Normal `q` does not exit while an owned Tool Tab has an unresolved launch or close result. Show shutdown progress in the Review Queue. If Herdr reports a cleanup failure, keep the application alive in a cleanup-failed state with retry information instead of claiming a clean exit.

For `SIGINT` and `SIGTERM`, start the same cleanup path and suppress OpenTUI's default immediate renderer destruction. A repeated termination signal can force application exit after best-effort cleanup, but the exit is explicitly unclean and Herdr can still own persistent Tool Tabs. No application can guarantee cleanup after `SIGKILL`, power loss, or Herdr server failure.

The ownership guarantee covers direct children and descendants that remain attached to the Tool Tab's process and terminal groups. It does not cover a Review Command that intentionally daemonizes, moves itself outside those groups, or delegates work to an external service.

## Temporary state boundary

Keep tool IDs, Herdr resource IDs, launch state, focus state, exit notices, and cleanup state only in memory. Do not write running, completed, failed, viewed, or reviewed tool state to the Review Queue or disk. A process restart discovers no prior application ownership; Herdr session persistence is not application review-progress persistence.
