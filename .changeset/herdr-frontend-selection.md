---
'code-review-tui': minor
---

Drive herdr-frontend instead of the Herdr app when `${XDG_CONFIG_HOME:-$HOME/.config}/herdr/frontend` contains `herdr-frontend`. Each action reads the file, so a switch applies to the next diff or Review Command without restarting `review`. herdr-core starts the new tab's terminal, and herdr-frontend names and focuses the tab. A missing or unreadable file keeps the Herdr app.
