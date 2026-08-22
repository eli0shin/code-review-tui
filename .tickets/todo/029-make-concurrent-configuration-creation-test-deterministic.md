---
Assigned-To:
Tags:
  - bug
Parent:
Blocked-By: []
---

## Goal

Remove timing-dependent CI failure from concurrent first-run Review configuration coverage while preserving the no-overwrite contract.

## Context

CI run `32545477763` for commit `b1ebdce7e905b7f18aeabc527983c856b4e40aea` failed only in `Review configuration contract > does not overwrite a configuration created concurrently`. The final file matched one complete valid writer, but `loadReviewConfiguration()` returned a failure because it read the competing writer's file before that writer finished. The Version workflow passed the same suite, which confirms timing dependence.

The product contract requires exclusive creation and no overwrite. It does not require coordination, waiting, retries, or guaranteed successful startup while another process is still writing the file.

## Done when

- Concurrent-creation coverage deterministically proves that neither writer overwrites the other.
- The test does not require the losing loader to read a competing file before that writer completes.
- Existing coverage still proves that a complete concurrently created configuration can be loaded.
- The full suite is stable across repeated runs.
- No product lifecycle machinery, retries, scheduler, or changeset is added.
