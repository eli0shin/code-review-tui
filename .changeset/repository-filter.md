---
'code-review-tui': minor
---

Filter either list by repository: `f` opens a panel listing every repository in the list's search, across all pages, with its pull request count. `space` checks repositories, `enter` shows only the one under the cursor, and `q` closes the panel. Each list keeps its own filter for the session, and toggling repository scope clears it. The repository list loads in the background once a minute, so the panel usually opens immediately. The new `filterRepositories` key binding defaults to `f`; a configuration that already binds `f` to another action must move one of them.
