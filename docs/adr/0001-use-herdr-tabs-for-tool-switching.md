# Use Herdr tabs for tool switching

`review` requires Herdr and keeps the Review Queue in its saved Review Queue Tab. It uses the installed `herdr` CLI to create and focus one Herdr tab for each Lumen or Review Command action. Herdr owns terminal input and rendering.

The launched shell runs one best-effort `herdr tab focus` command for the saved Review Queue Tab after the requested command exits. This avoids event tracking and can race with a user focus choice. Full terminal handoff was rejected because it permits only one active surface.

## Consequences

- `review` reports an actionable error when it does not have Herdr workspace and Review Queue Tab context.
- The Herdr adapter executes explicit `herdr tab create`, `herdr pane run`, and `herdr tab focus` CLI calls and parses only the created tab and pane IDs.
- `review` does not open a Herdr socket, implement its protocol, subscribe to events, or track launched command lifecycle.
- `review` does not embed child terminal emulators or implement terminal multiplexing.
