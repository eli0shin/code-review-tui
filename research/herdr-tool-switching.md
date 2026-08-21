# Herdr tool-switching boundary

## Current decision

Use the installed `herdr` CLI as the only Herdr boundary. The earlier direct-socket proposal is rejected. `review` does not open the Herdr socket or implement the Herdr protocol.

Herdr has workspaces, tabs, and panes. It has no cab object. For `review`, a normal Herdr tab is the smallest persistent terminal surface that lets Herdr own rendering and input while OpenTUI continues to own the Review Queue.

## Required CLI capabilities

The installed CLI provides the required operations:

- `herdr tab create --workspace WORKSPACE_ID --cwd PATH --label TEXT --no-focus` creates a shell-backed Herdr tab and returns JSON with `.result.tab` and `.result.root_pane`.
- `herdr pane run PANE_ID COMMAND` sends one shell command to the created pane.
- `herdr tab focus TAB_ID` focuses an exact tab.

Herdr injects `HERDR_ENV`, `HERDR_WORKSPACE_ID`, and `HERDR_TAB_ID` into a managed pane. `review` uses these values to create command tabs in the Review Queue workspace and to save the Review Queue Tab as its return target.

## Launch and return model

Create a new Herdr tab without focus, parse its tab and root-pane IDs, send the requested command to that pane, and then focus the created tab. The sent shell command appends `herdr tab focus REVIEW_QUEUE_TAB_ID`, so the shell makes one best-effort return after the requested command exits.

This return can race with the user's own focus action. `review` does not monitor or retry it. There are no event subscriptions, command lifecycle records, or socket compatibility requirements.

## Rejected alternatives

- **Direct Herdr socket integration:** Rejected because the CLI already provides the necessary create, run, and focus operations. A protocol client adds response schemas, subscriptions, reconciliation, reconnect, and lifecycle state that `review` does not need.
- **OpenTUI embedded terminal:** Rejected because Herdr already owns terminal rendering, input, and persistence.
- **Physical-terminal handoff:** Rejected because only one tool surface can stay active.
- **Herdr plugin overlay:** Rejected because it adds plugin packaging and fixed entrypoint requirements for a user-configured Review Command.
