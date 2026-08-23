---
Assigned-To: code-review-tui@039-run-the-lumen-capture-script-through-posix-sh
Tags:
  - bug
  - integration
Parent:
Blocked-By: []
---

## Problem

The v0.2.7 Lumen capture command injects POSIX shell syntax directly into the interactive shell in the created Herdr pane:

```sh
if comments=$(mktemp); then ...
```

`herdr pane run` submits text to that live shell. It does not select POSIX sh. When the user's shell is fish, fish rejects the assignment before Lumen starts:

```text
fish: Unsupported use of '='. In fish, please use 'set comments $(mktemp)'.
```

The released feature therefore does not work for fish users.

## Diagnosis

The exact v0.2.7 injected command was passed to `fish -n -c` with fish 4.8.1. It deterministically exits 127 at the initial `comments=$(mktemp)` assignment. The values and cleanup are not reached. The cause is the missing explicit POSIX shell boundary, not Lumen, Herdr focus, path construction, or value quoting.

## Outcome

Run the complete Lumen capture and cleanup script explicitly through `/bin/sh -c` so the user's interactive shell only parses one ordinary command invocation.

## Contract

Generate a complete POSIX script that preserves the landed contracts:

1. create a temporary file;
2. run `lumen diff PULL_REQUEST_URL` with stdout redirected to it;
3. replace `/tmp/review/lumen/<org>/<repo>/<number>.txt` only after a successful nonempty result;
4. otherwise remove only the temporary file and preserve prior comments;
5. independently make the existing best-effort attempt to focus the Pull Request List tab;
6. independently make the existing best-effort attempt to close the created Herdr tab.

Pass that complete script as one safely quoted argument to:

```text
/bin/sh -c '<complete script>'
```

The text submitted by `herdr pane run` must contain no bare POSIX assignment, `if`, test, redirection, or cleanup statement for the user's interactive shell to interpret. Do not implement separate fish, bash, zsh, or other shell variants. Do not detect the user's shell.

Keep Review Commands unchanged; they already use an explicit `/bin/sh -c` boundary. Keep the exact comment bytes, deterministic path, replacement rules, no-send behavior, no custom environment variables, and direct installed-Herdr CLI boundary unchanged.

Add a patch changeset and correct the external-process documentation.

## Acceptance evidence

- A regression test fails against the v0.2.7 bare command and proves that the generated pane command has the explicit `/bin/sh -c` boundary.
- Execute the generated pane command through real fish and prove that fish accepts it, Lumen starts, and successful nonempty stdout reaches the deterministic file.
- Existing exact-byte replacement, empty result, nonzero result, repeated replacement, hostile-value quoting, focus failure, close attempt, and Review Command tests continue to pass.
- Run formatting, lint, typecheck, all tests, build, and native executable smoke coverage.

## Resolution

Implemented in PR #42 and squash-merged as `4824b84a2a726cb4789c80451ff6c69288fc6b60`.
