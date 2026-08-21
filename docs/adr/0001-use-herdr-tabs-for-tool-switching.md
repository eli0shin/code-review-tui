# Use Herdr tabs for tool switching

`review` requires Herdr and keeps the Review Queue in its saved Herdr tab. It launches Lumen and each Review Command in a dedicated direct-process Tool Tab, lets Herdr own terminal input and rendering, and makes a best-effort attempt to return focus to the saved Review Queue pane when the tool exits. Focus restoration is not race-free and does not require new Herdr protocol capabilities. This avoids OpenTUI intercepting nested TUI key bindings while retaining concurrent, persistent tool sessions; full terminal handoff was rejected because it permits only one active surface.

## Consequences

- `review` reports an actionable startup error outside a compatible Herdr environment.
- A Herdr adapter creates Tool Tabs, correlates ordinary lifecycle events, and attempts to focus the saved Review Queue pane after tool exit. It does not chase event-ordering races.
- `review` does not embed child terminal emulators or implement terminal multiplexing.
