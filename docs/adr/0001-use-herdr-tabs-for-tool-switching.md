# Use Herdr tabs for tool switching

`review` requires Herdr and keeps the Review Queue in its saved Review Queue Tab. It uses the installed `herdr` CLI to create and focus one Herdr tab for each Lumen or Review Command action. Herdr owns terminal input and rendering.

After the requested command returns, the launched shell makes a best-effort attempt to focus the saved Review Queue Tab. It then makes a best-effort attempt to close its created Herdr tab. Semicolon sequencing makes the close attempt independent of the focus result. This avoids event tracking. Review Queue focus can race with a user focus choice. Full terminal handoff was rejected because it permits only one active surface.

## Consequences

- `review` reports an actionable error when it does not have Herdr workspace and Review Queue Tab context.
- The Herdr adapter executes explicit immediate `herdr tab create`, `herdr pane run`, and `herdr tab focus` CLI calls and parses only the created tab and pane IDs. The pane shell later executes the appended focus and close calls.
- `review` does not open a Herdr socket, implement its protocol, subscribe to events, or track launched command lifecycle.
- `review` does not embed child terminal emulators or implement terminal multiplexing.
