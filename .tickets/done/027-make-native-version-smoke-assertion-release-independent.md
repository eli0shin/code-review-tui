---
Assigned-To: code-review-tui@027-make-native-version-smoke-assertion-release-independent
Tags:
  - bug
Parent:
Blocked-By: []
---

## Goal

Unblock v0.2.1 publication by making the native `--version` smoke assertion follow the package version instead of a previous release number.

## Context

CI and Version runs for release commit `b1f307826416d80df2b85daeac27aabe3010a1fa` failed because `tests/native-smoke.test.ts` expected `0.2.0` while the built executable correctly printed `0.2.1`. The Version workflow stopped before tag creation and binary publication.

## Done when

- The native smoke test verifies the current package version without a release-specific hard-coded value.
- The test still proves that `review --version` does not create Review configuration.
- The full test suite passes at package version 0.2.1.
- No changeset is added for this test-only repair.

## Resolution

Implemented in PR #26 and squash-merged as `bbe887fd21bfb52ff0d3a3a63e5cbb2f5a483d4f`.
