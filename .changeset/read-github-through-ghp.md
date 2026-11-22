---
'code-review-tui': minor
---

Read GitHub through [ghp](https://github.com/eli0shin/gh-proxy), a cache that every process on the machine shares, instead of running `gh` for each read. A Review Queue page is now one read instead of one search plus one `gh pr view` per row, and Pull Request Details is one read instead of five or more. Many Review instances and agent sessions watching the same pull requests no longer exhaust the GitHub rate limit. Pages and details come from the shared cache when recent; `r` and the refresh after a Review Submission always read fresh data. Review now requires `ghp` on `PATH`.
