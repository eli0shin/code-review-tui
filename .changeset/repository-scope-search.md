---
'code-review-tui': minor
---

Add an optional `github.repositorySearch` that the Review Queue uses while repository scope is on, so a repository you own can keep showing pull requests you already reviewed (for example `is:pr state:open (review-requested:@me OR reviewed-by:@me)`) while the all-repositories queue keeps `github.search`. Each scope keeps its own session query edits. Without `github.repositorySearch`, repository scope keeps using `github.search`.
