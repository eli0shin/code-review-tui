---
Assigned-To:
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Goal

Remove the Herdr lifecycle machinery introduced by PR #17. No remaining feature work can start until this cleanup is accepted.

## Delete

Delete all public code, page code, tests, and documentation for:

- `ToolTabs` and “Tool Tab” terminology;
- `subscribe()` and public listener registration;
- `ToolNotice`;
- lifecycle-degraded and lifecycle-restored state;
- launch lockout based on lifecycle tracking;
- “launch is disabled” messages;
- indeterminate launch state;
- indeterminate launch acknowledgement;
- notice history, notice indexes, replay, and deduplication;
- reconnect coordination and snapshot reconciliation used to restore lifecycle state;
- public tool IDs and running/ended phase tracking.

## Keep

Keep only behavior required by the product:

- open Lumen in a Herdr tab;
- open the Review Command in a Herdr tab;
- return success or a launch failure from each open call;
- make one best-effort attempt to focus the Review Queue after an observed ordinary command exit;
- report a closed Review Queue pane to the runtime;
- disconnect from Herdr without closing launched Herdr tabs.

The Herdr adapter can consume Herdr events internally for focus restoration and Review Queue closure. It must not expose an event stream, subscription, listener set, event index, replay mechanism, or lifecycle state to React.

## Required result

- Rename the public interface to `Herdr`.
- Give the interface direct methods for opening Lumen, opening the Review Command, and disconnecting.
- A failed open call does not disable later calls.
- A Herdr event-stream failure does not disable later open calls.
- Remove obsolete tests instead of translating them into a new protocol.
- Add focused tests for direct open success, direct open failure, a later call after failure, best-effort focus, Review Queue closure, and disconnect.
- Update `CONTEXT.md`, active tickets, and architecture documents to use **Herdr tab** only.
- Do not add a replacement store, controller, event bus, callback registry, subscription API, state machine, or lifecycle coordinator.
