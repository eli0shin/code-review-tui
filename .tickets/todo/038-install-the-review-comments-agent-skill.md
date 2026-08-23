---
Assigned-To:
Tags:
  - feature
  - cli
Parent:
Blocked-By: []
---

## Problem

Lumen comments use a deterministic file schema, but an agent needs a small user-invoked skill that tells it where to read the comments. Installation must not require the user to manually create or update the skill file.

## Outcome

Add `review skill install`. It installs the bundled user-invoked `review-comments` skill into the global Agent Skills directory.

## Command contract

```text
review skill install
```

The command writes:

```text
~/.agents/skills/review-comments/SKILL.md
```

Resolve `~` from the user's home directory. Create missing parent directories with normal filesystem defaults. Always overwrite the destination with the bundled content. Do not compare existing content, preserve edits, require confirmation, create a backup, or add `--force`, update, or uninstall variants.

The command succeeds without complete Review TUI configuration, Herdr context, `herdr`, Lumen, or `gh`. A write failure prints one actionable diagnostic to stderr and exits nonzero. A successful install prints the destination path.

Do not add custom environment variables or configuration fields.

## Exact installed skill

Install a valid Agent Skills directory with this `SKILL.md`:

```markdown
---
name: review-comments
description: Read the Lumen review comments saved for the pull request under review.
disable-model-invocation: true
---

Read the review comments for the pull request under review from `/tmp/review/lumen/<org>/<repo>/<pull-request-number>.txt`.
```

The body has one instruction only. It tells the agent how to read the file. It does not tell the agent how to interpret, summarize, report, apply, submit, or otherwise use the comments.

`disable-model-invocation: true` keeps the skill user-invoked. The installed command is `/skill:review-comments` in agents that expose Agent Skills as commands.

Keep the bundled skill text in one production source of truth. Tests inspect that source through the install command; do not keep a second expected full skill body in production.

Update installation and usage documentation. Add a patch changeset.

## Acceptance evidence

- A filesystem contract test with a temporary home proves the exact destination and exact bytes.
- Running the command twice proves unconditional replacement of different existing content.
- Missing parent directories are created.
- Missing or unusable home and write failures produce an actionable nonzero result without changing unrelated files.
- The command does not read or initialize Review TUI configuration and does not require external CLIs.
- CLI help exposes `review skill install` and no unsupported skill-management operations.
- Existing TUI startup, update, version, and native executable contracts continue to pass.
