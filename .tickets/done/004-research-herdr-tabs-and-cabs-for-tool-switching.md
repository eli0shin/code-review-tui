---
Assigned-To: code-review-tui@004-research-herdr-tabs-and-cabs-for-tool-switching
Tags:
  - research
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Question

What tabs, cabs, process-launch, focus, and return-to-caller capabilities does Herdr provide, and can `review` use them without implementing its own terminal multiplexer?

## Resolution

Herdr can coordinate persistent tabs with direct argv launch, focus, `layout.apply`, and lifecycle events. It has no cab abstraction or general return-to-caller operation. A tool-switching prototype should test correlated layout application and event subscription before choosing Herdr as the control plane. See [Herdr tool-switching research](../../research/herdr-tool-switching.md).

Merged by [Document Herdr tool-switching capabilities](https://github.com/eli0shin/code-review-tui/pull/3) as commit `3ea2d8d`.
