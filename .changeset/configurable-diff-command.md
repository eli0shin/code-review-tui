---
'code-review-tui': minor
---

Add an optional `diffCommand` setting that replaces Lumen for `openDiff`. The Diff Command runs through `/bin/sh -c` in a Herdr tab and receives the same `REVIEW_PR_*` variables as the Review Command. Use it to show the merge-base pull request diff, because Lumen compares the base branch tip with the head.
