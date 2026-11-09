# Select the Herdr app before Herdr

A nonblank `HC_TERMINAL_ID` now selects the Herdr app even when `HERDR_ENV=1` is set.

Herdr runs in a terminal, so herdr-core is easily started from a Herdr pane. herdr-core then passes Herdr's `HERDR_ENV`, `HERDR_WORKSPACE_ID`, and `HERDR_TAB_ID` to every Herdr app terminal it runs, and `review` opened its tabs in a Herdr workspace instead of the Review Queue's app space. `HC_TERMINAL_ID` is set by herdr-core for its own terminal, so it is the more specific marker. Herdr running inside an app terminal now also uses the Herdr app while the window shows the terminal it was started from. Each action checks the window first, so when it does not show that terminal, a Herdr pane with complete Herdr context still opens its tab in Herdr.
