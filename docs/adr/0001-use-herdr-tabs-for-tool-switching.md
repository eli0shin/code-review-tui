# Use Herdr tabs for tool switching

`review` requires Herdr and keeps the Review Queue in its saved Herdr tab. It launches Lumen and each Review Command in a dedicated direct-process Tool Tab, lets Herdr own terminal input and rendering, and returns focus to the Review Queue Tab when the tool exits. This avoids OpenTUI intercepting nested TUI key bindings while retaining concurrent, persistent tool sessions; full terminal handoff was rejected because it permits only one active surface.

## Consequences

- `review` reports an actionable startup error outside a compatible Herdr environment.
- A Herdr adapter creates Tool Tabs, correlates lifecycle events, and restores the saved Review Queue Tab.
- `review` does not embed child terminal emulators or implement terminal multiplexing.
