---
Assigned-To: Pi
Tags:
  - prototype
  - hitl
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Question

What Review Queue row content, selection treatment, GitHub-like visual hierarchy, navigation, configurable action keys, refresh behavior, loading view, empty view, and help affordance make the pull requests fast to scan and act on?

## Resolution

Use the compact GitHub-style list without a surrounding border. Each row shows the title, persistent green pull request dot, `org/repo #123`, author, update age, `2 files +123 -123`, comment count, and labels. Use OpenCode v2-style terminal palette detection: terminal defaults, ANSI semantic colors, and generated muted/surface colors. Selection paints the full row with a subtle generated surface but does not change any text color or replace the green dot. Keep configurable `j`/`k` and arrow navigation, action keys in the footer, manual refresh, centered loading and empty states, and an on-demand effective-key help overlay.

The accepted prototype is preserved at [Review Queue prototype commit `d7ec7d7`](https://github.com/eli0shin/code-review-tui/tree/d7ec7d76c499ac53aef1e2a7cb9d1848403ca4a0).
