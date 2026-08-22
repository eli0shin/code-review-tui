---
Assigned-To:
Tags:
  - implementation
  - ui
Parent:
Blocked-By: []
---

## Problem

The OpenTUI application keeps the complete Review Queue, Pull Request Details, and Review Submission UI in one root implementation. It also hoists data loading, mutation state, input state, refs, failures, and rendering state to that root even when only one interaction uses them.

This has already caused defects during implementation. A change to one interaction requires reasoning about unrelated root state and input branches. The large UI file is the visible symptom; state and behavior are not local to the UI that uses them.

## Outcome

Organize the UI by the three user interactions: Review Queue, Pull Request Details, and Review Submission. Each interaction owns the data, state, input handling, rendering, and tests that change with it.

The root keeps only shared setup and coordination that is genuinely read or changed by more than one interaction. Do not keep state in the root only to pass it back down to one child.

## Required ownership

### Review Queue

The Review Queue UI owns:

- the Review Queue query, status, polling, cancellation, and manual refresh;
- the numeric Cursor and keeping it visible;
- Review Queue keyboard actions;
- Herdr actions and their immediate failures;
- the captured target used to open Pull Request Details or Review Submission;
- queue-level notices shown after an interaction closes; and
- rendering the queue, rows, queue failures, help, and active child interaction.

The Review Queue passes a captured pull request target and close or completion callbacks to child interactions. It does not fetch Pull Request Details. It does not own a Review Submission draft or mutation.

### Pull Request Details

The Pull Request Details UI owns:

- the React Query details query keyed by the captured pull request URL;
- loading on every opening, explicit refresh, caching, status, and cancellation;
- the details viewport and diagnostic viewport refs;
- all details-only keyboard handling and input isolation;
- source availability, conversation merging, unavailable markers, and complete diagnostics;
- scrolling by line, page, start, and end; and
- the complete full-screen details rendering.

Opening Pull Request Details gives this UI the captured target. Closing it returns only a close event to the Review Queue.

Keep the existing independent-source behavior. The GitHub adapter can return successful metadata, reviews, checks, issue comments, or inline comments while another source fails. Pull Request Details must render every successful source, merge every successful conversation source chronologically, mark only the failed content unavailable, and keep each complete unchanged diagnostic reachable. It must continue to refresh all sources together rather than add source-specific retries.

### Review Submission

The Review Submission UI owns:

- target, message, decision, focus, confirmation choice, validation, in-flight, and failure state;
- the editor ref and duplicate-submission protection;
- all submission-only keyboard handling and input isolation;
- blank-message validation for Comment and Request changes;
- safe cancellation and discard confirmation;
- the GitHub Review Submission mutation;
- preserving the exact draft after failure and allowing explicit retry; and
- invalidating or refetching the Review Queue after success.

Opening Review Submission gives this UI the captured target. On success it closes and reports the completed decision and target so the Review Queue can show its queue-level notice. On cancellation it closes without changing the Review Queue. The Review Queue must not own or mirror the draft, mutation, validation, confirmation, or failure state.

## UI structure

- Keep production adapter creation, renderer creation, mounting, and runtime lifecycle separate from feature UI definitions.
- Give Review Queue, Pull Request Details, and Review Submission their own cohesive UI files.
- Keep queue rows and viewport rendering with the Review Queue unless their size justifies one queue-specific child file.
- Keep terminal theme, keyboard descriptor interpretation, and reusable status or diagnostic surfaces in focused shared UI files only when more than one interaction uses them.
- Keep feature-specific helpers beside their feature. Do not create catch-all utility files or barrel exports.
- Keep dependencies one-way: the Review Queue composes child interactions; child interactions do not import the Review Queue; shared UI does not import a feature.

This is not a visual redesign. Preserve the current layout, text, keys, input precedence, notices, and source diagnostics unless a movement is required to put existing behavior with its owner.

## Test locality

Split the page test coverage by the same interaction ownership while continuing to exercise rendered behavior:

- Review Queue tests cover mount loading, manual refresh, 60-second polling, cancellation, Cursor movement, queue status, help, Herdr actions, and opening captured targets.
- Pull Request Details tests cover loading on every opening, explicit refresh, captured target stability, cached content during refresh, source-level partial success, chronological conversation merging, complete diagnostics, configurable scrolling, input isolation, and close behavior.
- Review Submission tests cover exact draft editing, decisions, validation, cancellation, discard confirmation, duplicate-submit prevention, exact mutation input, failure preservation, retry, success notice data, and Review Queue invalidation or refetch.
- Shared fixtures can provide stable pull requests, effective key bindings, in-memory GitHub and Herdr implementations, and renderer setup. Do not hide scenario behavior in a generic test harness.

Tests must use the UI that owns the behavior. Do not test local state by reaching through a parent or by exporting implementation-only state transitions.

## Documentation

Update the module architecture decision so it no longer says that the root Review Queue page directly owns Pull Request Details loading or Review Submission state and actions. Document that each interaction owns the React Query operation and temporary state that only it uses, while the Review Queue owns cross-interaction targets and queue-level behavior.

Keep the existing GitHub refresh, Pull Request Details, Review Submission, Herdr, and runtime contracts otherwise unchanged.

## Non-goals

- Do not change the GitHub or Herdr interfaces or CLI adapter behavior.
- Do not add a new result model for Pull Request Details.
- Do not add a store, controller, reducer, state machine, event bus, feature registry, or generic modal framework.
- Do not move hoisted state into one root custom hook; that preserves the same ownership problem under another name.
- Do not make the parent fetch child data and pass data, loading flags, failures, drafts, or mutation state through props.
- Do not change configuration defaults, key-binding validation, Review Queue membership, or persistence.

## Acceptance criteria

- [ ] The production launch implementation contains no feature UI definitions.
- [ ] Review Queue, Pull Request Details, and Review Submission have separate cohesive UI ownership.
- [ ] Pull Request Details owns its query, refresh, status, failures, refs, input, and rendering.
- [ ] Review Submission owns its draft, validation, confirmation, mutation, failure, retry, and cancellation state.
- [ ] Review Queue owns only queue behavior and cross-interaction coordination.
- [ ] No root state remains when only one child interaction reads or changes it.
- [ ] Independent Pull Request detail source failures still leave every successful section visible with complete diagnostics reachable.
- [ ] Successful Review Submission still closes, reports the exact target and decision, and refreshes the Review Queue without optimistic removal.
- [ ] Existing input isolation and captured-target behavior remain unchanged.
- [ ] Focused tests follow the interaction that owns each behavior, and all existing behavior remains covered.
- [ ] Module architecture documentation records the new state and data ownership.
- [ ] Formatting, lint, type checking, and the complete test suite pass.
- [ ] A patch changeset describes the UI architecture refactor with no claimed user-visible behavior change.
