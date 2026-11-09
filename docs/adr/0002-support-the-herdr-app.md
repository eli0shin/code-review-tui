# Support the Herdr app alongside Herdr

The Herdr app is a separate product from Herdr: herdr-core runs its terminals, and the `herdr-app` CLI arranges them in spaces and tabs. Its terminals have no `HERDR_ENV`, so `review` refused to start in them. `review` now also opens its Herdr tabs through `herdr-app` when `HC_TERMINAL_ID` identifies its terminal, keeping Herdr's behavior: one new tab per action in the Review Queue's space, `review`'s environment plus the pull request values, and best-effort return focus followed by closing the tab.

`herdr-app do tab.new` takes a program rather than a shell command and has no environment option, so the tab runs `/usr/bin/env` with the child environment before `/bin/sh -c`. The app wraps that program in the login shell and leaves an interactive shell when it returns, so the cleanup ends the tab's own terminal instead of closing a tab by ID; the tab's ID is not known to the program it runs.

`HERDR_ENV=1` keeps precedence, so Herdr running inside an app terminal still uses Herdr. Superseded by [ADR 0003](./0003-select-the-herdr-app-before-herdr.md): `HC_TERMINAL_ID` now takes precedence.
