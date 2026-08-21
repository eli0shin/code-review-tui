---
Assigned-To: code-review-tui@003-research-opentui-control-of-interactive-child-terminals
Tags:
  - research
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Question

Which OpenTUI React and terminal APIs can launch, display, suspend, resume, and switch to interactive child terminal applications while preserving input, alternate-screen state, resize behavior, and clean shutdown?

## Resolution

OpenTUI can retain compatible interactive tools in embedded PTY terminal renderables with explicit focus, resize, and cleanup control. Whole-terminal suspension and repaint remain available, and Lumen specifically keeps the established physical-terminal foreground handoff. See [OpenTUI interactive child terminal research](../../research/opentui-interactive-child-terminals.md).

Merged by [Document OpenTUI interactive child terminal control](https://github.com/eli0shin/code-review-tui/pull/4) as commit `987c9c5`.
