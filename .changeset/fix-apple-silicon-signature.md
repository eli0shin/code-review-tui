---
'code-review-tui': patch
---

Build releases with Bun 1.4.4 to fix invalid ad-hoc code signatures that caused macOS 27 to kill Review at startup on Apple Silicon. Verify the exact release binary's signature and startup on macOS before publishing it.
