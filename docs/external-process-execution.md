# External process execution contract

## Decision

`review` requires a compatible Herdr session. The Review Queue stays in a tracked Herdr tab. Each Lumen or Review Command process runs directly in a new, dedicated Tool Tab in the Review Queue's current workspace. Herdr owns the Tool Tab pseudo-terminal (PTY), rendering, input, resize delivery, and process persistence. `review` owns launch correlation, lifecycle notices, return focus, and shutdown of every Tool Tab that it creates.

This contract replaces physical-terminal handoff and OpenTUI-embedded terminals for these tools. It implements the accepted [Herdr tab decision](adr/0001-use-herdr-tabs-for-tool-switching.md). It does not add a terminal emulator or multiplexer to `review`.

## Required Herdr context

At TUI startup, require all of these conditions:

- `HERDR_ENV=1`;
- nonblank `HERDR_SOCKET_PATH`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, and `HERDR_PANE_ID` values injected by Herdr;
- a reachable Herdr socket whose protocol supports `session.snapshot`, `layout.apply`, `pane.get`, `pane.focus`, `pane.close`, and event subscriptions;
- an immutable client launch token accepted by `layout.apply`, attached to the created pane across rename and movement, and exposed by `pane.get` and snapshots;
- one global monotonic event sequence, a snapshot cursor that identifies the last event reflected in that snapshot, and subscription resume after a supplied cursor;
- `pane.exited` data that identifies whether its pane owned focus immediately before exit, focus-event data that distinguishes a user focus choice from Herdr's lifecycle fallback, and an atomic conditional `pane.focus` that rejects the request if a user focus choice occurred after a supplied cursor; and
- a snapshot in which the supplied workspace, Review Queue Tab, and Review Queue pane exist and have the stated relationship.

The initial `HERDR_PANE_ID` identifies the Review Queue pane. From the startup snapshot, save that pane's stable Herdr terminal ID in addition to its current pane, tab, and workspace IDs. The initial tab and workspace IDs establish its first saved return target. Use the stable terminal ID to find the pane and update all current resource IDs from later snapshots. Create later Tool Tabs in the Review Queue's current saved workspace. Do not derive the return target from whichever tab is focused.

Failure of any startup condition stops TUI startup. Identify Herdr, the missing or incompatible condition, and the action to start or update Herdr and run `review` inside a Herdr pane. Do not silently fall back to an ordinary terminal, physical-terminal handoff, or an OpenTUI embedded PTY.

Open a fresh control connection for every `session.snapshot`, `layout.apply`, focus, close, or other request. Keep a control connection only until its response, error, end-of-file, or timeout. Concurrent requests use separate connections.

Use one separate, persistent `events.subscribe` connection. Take the startup snapshot, then subscribe strictly after its cursor and process later events in global sequence order. Herdr must retain events across this snapshot-to-subscribe interval so the cursor closes the observation gap. An event normally requests snapshot reconciliation; movement, ownership, and completion change only from an authoritative snapshot. The pre-exit-focus and focus-reason fields are the limited event facts used to decide return focus.

Coalesce reconciliation requests with one active snapshot and at most one pending snapshot. Request IDs correlate replies on their individual connections. Stable terminal IDs correlate resources across snapshots. A cursor gap, out-of-order event, or resume failure makes focus provenance unknown until a new snapshot and subscription cursor establish a baseline.

Herdr v0.8.2 does not expose these event cursors or focus facts and is not compatible with this contract. Startup must reject it with an actionable version or protocol-capability error. Do not weaken return-to-queue behavior or guess whether a fallback focus was a user choice.

## Tool launch model

A queue action starts one launch operation for the selected pull request. Generate a unique, in-memory tool ID before sending the request and use it as the immutable Herdr launch token. The launch has these states:

1. **launching**: subscribed, but no confirmed Tool Tab exists;
2. **running**: Herdr returned the Tool Tab and pane IDs and a snapshot confirmed the pane;
3. **indeterminate**: the launch request can have taken effect, but no current resource can prove its outcome;
4. **closing**: `review` requested closure and is waiting for Herdr confirmation; and
5. **ended**: no owned pane or Tool Tab remains.

Use `layout.apply` to create one focused tab with one direct argv-backed pane and attach the tool ID as immutable protocol metadata. Set a concise tab and pane label that distinguishes Lumen from a Review Command and includes the pull request repository and number. Also put the ID in the pane environment as `REVIEW_TOOL_ID`. Labels are mutable presentation data and are never lifecycle identity. The token and environment value are lifecycle correlation data, not durable Review Queue state.

Coalesce event notices received while the matching `layout.apply` control connection is unresolved. After a successful response supplies the pane and tab IDs, open a fresh control connection for `pane.get` with the returned pane ID. Herdr retains that old ID as an alias if another client moves the pane across workspaces, so this request captures the stable terminal ID even after a move or rename. Then take an authoritative snapshot, find the pane by stable terminal ID, and save its current pane, tab, and workspace IDs before reporting the tool as running. If notices arrived during this baseline, request one follow-up snapshot. Do not apply buffered event payloads directly.

If `pane.get` returns `pane_not_found`, the successful response confirmed launch but the tool ended before ownership baselining completed. Mark it ended, keep focus provenance unknown, and do not restore the Review Queue from that transition. Any other `pane.get` control failure keeps the launch unresolved and its returned pane ID owned; retry `pane.get` rather than falling back to mutable labels.

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

Subscribe to `pane.exited`, `pane.closed`, `pane.moved`, `pane.focused`, `tab.closed`, `tab.moved`, `tab.focused`, `workspace.closed`, and `workspace.focused`. Use lifecycle events to request snapshot reconciliation; use only the ordered pre-exit-focus and focus-reason facts for the separate return-focus decision. Find owned tool panes and the Review Queue pane by stable terminal ID in each snapshot, then update their current pane, tab, and workspace IDs. Track pane focus separately from tab focus so that an unrelated pane added to a Tool Tab does not count as the tool owning focus. A transition from present to absent in authoritative snapshots confirms completion. Duplicate or replayed notices can request extra snapshots but cannot produce duplicate completion.

Absence of the saved Review Queue tab or workspace is provisional because the Review Queue pane can have moved to a new container. Do not start shutdown from a tab or workspace event alone. Update the saved return target when the next snapshot finds the stable Review Queue terminal in a new container. Start shutdown only when snapshot reconciliation confirms that the Review Queue pane is absent.

When a direct process exits, Herdr removes its pane and removes the Tool Tab when it is empty. `review` must not close or modify a tab that now contains a pane it does not own.

Track user-originated `pane.focused`, `tab.focused`, and `workspace.focused` events in global sequence order. Herdr's automatic fallback after a Tool Tab exits is lifecycle-originated and is not a user focus choice.

Before return focus, consume ordered events through the reconciliation snapshot's cursor. When the matching ordered `pane.exited` event says that exact owned tool pane owned focus immediately before exit and no user-originated focus event follows it through that cursor, request the saved Review Queue pane with conditional `pane.focus`, supplying the reconciliation cursor. Herdr must atomically reject the focus if any user-originated focus occurred after that cursor and before the request is applied. A guard rejection preserves the user's current focus and is not retried. Ignore only the lifecycle fallback surface that Herdr selected because the Tool Tab disappeared. If the exit focus fact is absent, the event sequence has a gap, the subscription reconnected without a continuous cursor, or a later user focus choice exists, preserve the latest authoritative snapshot focus. A background or uncertain tool exit must not steal focus.

If the saved Review Queue pane exists but conditional `pane.focus` fails for a reason other than its user-focus guard, show a recoverable Herdr control failure. If its saved pane, tab, or workspace is absent, disable launches and reconcile the Review Queue pane by stable terminal ID through a fresh snapshot. Update the saved resource IDs and retry `pane.focus` when the pane exists in a new container. Start shutdown only when the snapshot confirms that the Review Queue pane no longer exists.

Herdr's accepted `pane.exited` event does not include the direct process exit status or terminating signal. Treat every observed exit as completion and do not claim whether the tool succeeded. The Tool Tab is the tool's output surface while it runs. Closure requested by `review` during shutdown is also completion, not a tool failure.

An exit does not change Review Queue membership, add review progress state, or cause an automatic refresh.

## Launch and control failures

Keep launch failures at the queue action boundary. Preserve the Review Queue and selected pull request and permit the user to retry the action. Never retry a tool launch automatically because a Review Command can have non-idempotent effects.

Distinguish these cases:

- **Precondition failure:** no selected pull request, no repository working directory for Lumen, or invalid saved Herdr context. Do not send `layout.apply`.
- **Could not start:** Herdr rejects tab or direct process creation. Name the executable, pull request, Herdr error code, and operating-system error when available.
- **Control failure:** focus, close, subscription, or socket operations fail after creation. Keep ownership of any known Tool Tab until Herdr confirms that it ended.

Once Herdr starts the direct process, `review` cannot distinguish a successful exit, nonzero exit, or terminating signal. In particular, `/bin/sh` can start and then return status 126 or 127 for a Review Command, but Herdr does not expose that status. Do not misreport this completion as a launch failure or success.

A failed `layout.apply` response means no Tool Tab exists only when Herdr says the request made no change. Loss or timeout of that request's control connection has an unknown result. Open a fresh control connection for `session.snapshot` and look for the immutable launch token. If a matching resource exists, adopt it as owned, capture its stable terminal ID, and continue reconciliation. Rename and movement cannot break this lookup.

If no matching resource exists, the process can still have started, performed work, and ended before the snapshot. Set the launch to **indeterminate**. Do not claim that it failed or completed, and do not permit an automatic or ordinary retry. Show that the command may already have run and require explicit user acknowledgement before enabling a new launch action. Acknowledgement clears the safety interlock only; it does not assert an outcome.

If the event-subscription connection disconnects, mark tool lifecycle as degraded and disable new launches. Resume after the last processed cursor. If Herdr confirms continuous replay, process events in sequence and reconcile normally. If the cursor is no longer retained or continuity cannot be proved, take a fresh snapshot and start a new subscription strictly after its cursor. Existing tools continue under Herdr. First find the Review Queue pane by stable terminal ID and update its current pane, tab, and workspace IDs; start shutdown if it is absent. Then reconcile each owned tool resource as running or ended.

Focus provenance across an unfillable cursor gap is unknown. If the new baseline shows that a tool ended during that gap, mark the tool ended and preserve the surface that the snapshot says is now focused. Resume validated return-focus handling only for exits after the new cursor baseline. Do not restore the Review Queue from socket loss alone.

## Shutdown

One asynchronous shutdown coordinator owns quit, end-of-input, confirmed Review Queue pane closure, `SIGHUP`, `SIGINT`, and `SIGTERM`. Install handlers that suppress the operating system's default immediate exit for these signals. The first request makes shutdown irreversible:

1. stop accepting queue actions and new launches;
2. settle every unresolved launch through its control response or snapshot reconciliation;
3. request `pane.close` for every tool pane still owned by `review`, using one fresh control connection per close request;
4. wait for matching close or exit confirmation;
5. settle each active request connection or close it after its timeout;
6. close the event-subscription connection;
7. unmount the React root and destroy the OpenTUI renderer; and
8. exit with the reason's appropriate status.

Close owned tool panes concurrently, but correlate every result separately. Always use `pane.close`, including when the last snapshot showed an unchanged dedicated Tool Tab. This avoids a race in which another client adds or moves an unrelated pane into that tab before a separate `tab.close` request arrives. Herdr removes the Tool Tab when closing its owned process pane leaves the tab empty. Never close the Review Queue pane or tab through the cleanup path.

Normal `q` does not exit while an owned Tool Tab has an unresolved launch or close result. Show shutdown progress in the Review Queue. If Herdr reports a cleanup failure, keep the application alive in a cleanup-failed state with retry information instead of claiming a clean exit.

For `SIGINT` and `SIGTERM`, start the same cleanup path and suppress OpenTUI's default immediate renderer destruction. For `SIGHUP`, which Herdr sends before it closes the Review Queue pane, immediately stop launches and issue `pane.close` for all known tool panes concurrently before other reconciliation or renderer cleanup. This conservative path does not need a current Tool Tab topology and cannot close unrelated panes. If the process remains alive, complete the normal shutdown sequence.

Herdr can escalate pane closure from `SIGHUP` to `SIGTERM` and `SIGKILL` after its grace period. Cleanup caused by external closure of the Review Queue pane is therefore best effort and can be cut off by Herdr before confirmations arrive. A repeated termination signal can also force application exit after best-effort cleanup. These exits are explicitly unclean, and Herdr can still own persistent Tool Tabs. No application can guarantee cleanup after `SIGKILL`, power loss, or Herdr server failure.

The ownership guarantee covers direct children and descendants that remain attached to the Tool Tab's process and terminal groups. It does not cover a Review Command that intentionally daemonizes, moves itself outside those groups, or delegates work to an external service.

## Temporary state boundary

Keep tool IDs, Herdr resource IDs, launch state, focus state, exit notices, and cleanup state only in `review` memory. Herdr retains a tool ID only as immutable metadata on the live pane that it correlates; this is process ownership metadata, not Review Queue progress. Do not write running, completed, failed, viewed, or reviewed tool state to the Review Queue or disk. A process restart discovers no prior application ownership; Herdr session persistence is not application review-progress persistence.
