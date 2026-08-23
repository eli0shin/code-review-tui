---
Assigned-To: code-review-tui@037-capture-sent-lumen-comments-in-the-deterministic-temporary-file
Tags:
  - feature
  - integration
Parent:
Blocked-By: []
---

## Problem

Lumen 2.31 can write sent annotations as clean stdout, but the current Herdr command leaves stdout attached to the temporary pane. The existing cleanup then focuses the Pull Request List tab and closes the Lumen tab, so later code-review sessions cannot read the comments.

## Outcome

Capture explicitly sent Lumen comments as exact text at one deterministic temporary path for the pull request. Keep Lumen and Review Commands as separate interactions. A later agent reads the file only when the user invokes the separate `review-comments` skill.

## Contract

For a pull request with repository `<org>/<repo>` and number `<number>`, use this literal path schema:

```text
/tmp/review/lumen/<org>/<repo>/<number>.txt
```

The path excludes the GitHub host. Do not use XDG state, the user's home directory, an operating-system-derived temporary root, a hash, or a custom environment variable.

Change only the shell command injected into the created Lumen Herdr tab:

1. Create a temporary file with the system `mktemp` command.
2. Run the fixed `lumen diff PULL_REQUEST_URL` command with stdout redirected to that temporary file. Lumen continues to own the visible terminal through its `/dev/tty` behavior.
3. If Lumen exits successfully and the temporary file is nonempty, create the deterministic destination directory and move the temporary file over the deterministic destination.
4. If Lumen exits unsuccessfully or the temporary file is empty, remove the temporary file and leave any existing destination file unchanged.
5. Then make the existing independent best-effort attempt to focus the Pull Request List tab and close the created Herdr tab.

The destination contains the exact bytes that Lumen wrote to stdout. Do not parse, normalize, decorate, merge, append, or add pull request metadata. A later successful nonempty send replaces the complete prior file.

Keep this as shell composition inside the existing Herdr CLI boundary. Add no application writer, file repository, state model, polling, IPC, callback, Herdr output read, lifecycle tracking, notification, or Review Command handoff. Do not submit the comments to GitHub. Do not inject them into a Review Command.

Use shell quoting for the pull request URL and every generated path. Keep the configured Review Command command and environment unchanged.

Update the Lumen usage documentation and the researched external-process contract. Add a patch changeset.

## Acceptance evidence

- The recording Herdr CLI contract proves the exact injected shell behavior and unchanged focus-then-close cleanup order.
- A successful Lumen send with nonempty stdout replaces `/tmp/review/lumen/<org>/<repo>/<number>.txt` with exact stdout.
- A normal Lumen exit with empty stdout preserves an existing destination.
- A nonzero Lumen exit preserves an existing destination.
- Repeated successful sends replace rather than append.
- Repository and pull request values cannot escape or alter the generated shell command.
- Lumen launch validation, Review Command launch, immediate Herdr failures, later calls after failure, and native executable smoke coverage continue to pass.

## Resolution

Implemented in PR #39 and squash-merged as `c32e8790c1e112677e1f24320013d888f352c43b`.
