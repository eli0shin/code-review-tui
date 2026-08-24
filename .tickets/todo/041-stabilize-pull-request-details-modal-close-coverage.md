---
Assigned-To:
Tags:
  - bug
  - test
  - ui
Parent:
Blocked-By: []
---

## Problem

The v0.2.9 Version workflow failed before publication because this details-modal test timed out:

```text
Review Queue page loading > the modal captures its target, owns input, and refetches on every opening
Timed out waiting for frame predicate after 20 passes
```

The failure is reproducible locally. Running only that test in a loop failed on iteration 16 of 100. At the failure, line 715 waits for the Pull Request List after Escape, but the last frame still shows the first target's Pull Request Details modal. OpenTUI reports no scheduled render. CI on the same commit passed, which confirms the test or interaction is nondeterministic rather than consistently invalid.

The exact red-capable loop is:

```sh
for i in $(seq 1 100); do
  bun test tests/app.test.tsx \
    --test-name-pattern 'the modal captures its target, owns input, and refetches on every opening' || exit 1
done
```

## Outcome

Make Pull Request Details modal closure and its test deterministic after OpenTUI Markdown rendering, then restore reliable release publication.

## Contract

- Diagnose whether Escape is lost by the application interaction, React/OpenTUI scheduling, or the test driver. Fix the correct production or test seam; do not hide an application input defect with a longer timeout or retry.
- Preserve the full-screen Pull Request Details modal, OpenTUI Markdown bodies, captured pull request target, modal-owned input, per-opening refetch, configurable close controls, and Pull Request List Cursor behavior.
- Drive React and OpenTUI test updates through their supported `act` and asynchronous input/render APIs. Remove new or directly touched unwrapped-update warnings where the supported API permits it.
- Keep the test's behavioral assertions. Do not skip it, weaken it to a static snapshot, raise the global frame-pass count, or add nondeterministic sleeps.
- Add a patch changeset because v0.2.9 publication was blocked after its release merge. If investigation proves that only the release workflow needs a rerun and no repository change is correct, document that evidence instead of making a speculative change.

## Acceptance evidence

- Capture the root cause and show the original isolated loop red before the fix.
- The isolated test passes 100 consecutive runs after the fix.
- The complete test suite passes repeatedly enough to exercise the corrected interaction.
- Formatting, lint, typecheck, build, and all four native executable smoke checks pass.
- The Version workflow can publish v0.2.9 with exactly four native binaries and only the intended OpenTUI Markdown release note. A later patch release is created only if the repository fix requires it.
