---
Assigned-To:
Tags:
  - bug
Parent:
Blocked-By: []
---

## Goal

Make the generated default Review Command valid for the installed Pi CLI.

## Context

The v0.2.1 generated configuration uses `pi --prompt`, but Pi has no `--prompt` option. Pi accepts an initial interactive prompt as a positional argument. Running the generated Review Command fails immediately with `Error: Unknown option: --prompt`.

## Required default

```json
"reviewCommand": "pi \"review the changes in this pr and report your findings to me: $REVIEW_PR_URL\""
```

The Review Command remains an opaque configured shell command after generation.

## Done when

- Newly generated configuration contains the exact valid command above.
- Configuration contract and native startup coverage expect the valid command.
- User documentation shows the valid command.
- Existing user configuration is never rewritten.
- A patch changeset records the fix.
