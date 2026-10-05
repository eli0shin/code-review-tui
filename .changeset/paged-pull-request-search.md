---
'code-review-tui': minor
---

Load pull request searches one page at a time to reduce startup time and GitHub API requests. Navigate with `n` / `p` and configure `github.pageSize` (default 25). Manual refresh starts at page 1; automatic refresh keeps the current page's start cursor and returns to page 1 if that page becomes empty.
