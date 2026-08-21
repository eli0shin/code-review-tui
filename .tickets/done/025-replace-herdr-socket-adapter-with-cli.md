---
Assigned-To: code-review-tui@025-replace-herdr-socket-adapter-with-cli
Tags:
  - task
  - afk
Parent: 001-build-the-review-cli
Blocked-By: []
---

## Decision

The Herdr socket adapter merged in PR #17 is rejected wholesale.

`review` must use the installed `herdr` CLI as its only Herdr boundary. The orchestrator's `spawn-worker` script is the established example: execute `herdr` commands, read their JSON output, and use the returned IDs.

No remaining feature work can start until this cleanup is accepted.

## Delete

Delete all code, tests, changesets, and documentation for:

- direct Herdr socket access;
- Herdr RPC requests and responses;
- event subscriptions;
- snapshots and reconciliation;
- reconnect behavior;
- lifecycle state;
- launch lockout;
- indeterminate launches and acknowledgement;
- notices, listeners, indexes, replay, and deduplication;
- public tool IDs and running/ended phases;
- Herdr connection startup and shutdown.

Delete the fake socket server tests. Do not translate them into another protocol implementation.

## Replace

- Add a small `Herdr` interface for opening Lumen and opening the Review Command.
- Implement it by executing the installed `herdr` CLI with explicit arguments.
- Parse only the JSON needed from each CLI response.
- Use Herdr CLI commands to create and focus Herdr tabs and run the requested command.
- Keep the existing best-effort return to the Review Queue after the launched command exits. Implement it with Herdr CLI commands, not event tracking.
- Return success or the immediate CLI failure to the caller.
- A failed call must not disable later calls.
- There is no Herdr connection to start, monitor, reconnect, or shut down.

## Tests

Use a fake `herdr` executable or process runner. Test only:

- exact CLI calls for Lumen;
- exact CLI calls for the Review Command;
- CLI JSON parsing;
- immediate CLI failure;
- a later call after failure;
- the best-effort Review Queue focus command.

## Constraints

- Use **Herdr tab**. Do not use “Tool Tab” or `ToolTabs`.
- Do not open a Herdr socket.
- Do not implement the Herdr protocol.
- Do not add a subscription, listener, callback registry, event bus, store, controller, state machine, lifecycle coordinator, or shutdown coordinator.
- Update active tickets and architecture documents so they describe CLI execution only.

## Resolution

Implemented and merged in PR #19 as commit `6eca75565ea2d3dbdab3f23a63e53934998a6b5c`.
