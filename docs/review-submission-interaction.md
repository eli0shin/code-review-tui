# Review Submission interaction

## Decision

Compose one top-level Review Submission in a modal over the Review Queue. The modal contains one multiline message editor and one three-value decision selector. It does not support file selection, line selection, pending reviews, or inline comments.

Opening the modal captures the URL under the Cursor as its target. Later Cursor movement or detail updates cannot change that target. The header identifies the target as `OWNER/REPOSITORY #NUMBER` and shows its title so that the user can verify where the review will go.

Only one Review Submission interaction can be open, and only one submission can be active.

## Layout

Use this compact order:

1. `Review OWNER/REPOSITORY #NUMBER` and the pull request title;
2. a multiline message editor that uses the available modal height;
3. a decision selector with `Comment`, `Approve`, and `Request changes`;
4. an inline validation or submission failure, when present; and
5. a footer with the effective controls: `Tab decision`, `Ctrl+S submit`, and `Esc cancel`.

The selected decision must have a persistent visual mark. Do not communicate it by color alone. The initial decision is `Comment`, which is the least privileged choice. The message editor receives initial focus.

The modal owns input while it is open. Review Queue bindings do not run, and the Cursor does not move behind the modal.

## Editing and decision controls

The controls inside this interaction are fixed and are not part of the configurable Review Queue key bindings:

- Printable input edits the message.
- `Enter` inserts a newline. It never submits.
- The normal editor navigation, selection, deletion, and paste controls remain available.
- `Tab` moves from the editor to the decision selector. `Shift+Tab` moves back to the editor.
- In the decision selector, `Left` and `Right` select the previous or next decision without wrapping. `Home` selects `Comment`; `End` selects `Request changes`.
- `Ctrl+S` attempts submission from either control.
- `Escape` starts cancellation when no submission is active.

Changing the decision does not change, clear, or insert message text.

## Validation

A `Comment` or `Request changes` message must contain at least one non-whitespace character. An `Approve` message can be empty.

Validate only when the user attempts submission. If validation fails, do not start GitHub CLI. Keep the draft and decision unchanged, put focus in the editor, and show the requirement next to it. Editing after a validation failure clears that validation message.

Whitespace is ignored only to decide whether a required message is blank. Do not trim or otherwise rewrite a valid message before submission.

## Safe cancellation

An untouched interaction with the initial empty message and `Comment` decision closes immediately on `Escape`.

If the message or decision changed, `Escape` opens an in-modal discard confirmation. `Keep editing` is the initial choice. `Enter` activates the selected choice, `Left` and `Right` change the choice, and `Escape` returns to editing. Choosing `Discard` closes the interaction and drops the draft without calling GitHub CLI.

A canceled or discarded draft is not saved and does not change the Review Queue. The application does not persist Review Submission drafts.

After submission starts, disable editing, decision changes, duplicate submission, and cancellation until the GitHub CLI process ends. Show `Submitting comment`, `Submitting approval`, or `Submitting request for changes` with an active progress indicator.

## GitHub CLI submission

Start `gh` directly, without a shell, with the captured pull request URL and exactly one decision flag:

```text
gh pr review <pull-request-url> --comment --body-file -
gh pr review <pull-request-url> --approve --body-file -
gh pr review <pull-request-url> --request-changes --body-file -
```

Write the exact message to standard input as UTF-8 and close standard input. Send empty standard input for an approval with no message. Do not put the message in an argument, temporary file, environment variable, or shell command.

The pull request URL and process environment follow the [GitHub CLI integration contract](./research/github-cli-integration-contract.md). A submission creates one complete, top-level review. The application does not create a pending review and does not send file or line comments.

## Success

GitHub CLI exit status 0 means that the Review Submission succeeded. Close the modal and show a queue-level notice that names both the target and the submitted decision, for example:

```text
Approved OWNER/REPOSITORY #NUMBER. Refreshing Review Queue…
```

Use `Commented on` and `Requested changes on` for the other decisions. Start the required Review Queue refresh immediately. Do not remove or mark the pull request optimistically.

The success notice remains independently meaningful if the refresh fails. In that case, show both facts: the Review Submission succeeded and the Review Queue could not be refreshed. Queue replacement and notice behavior follow the [GitHub data refresh and failure contract](./github-data-refresh-and-failure-behavior.md).

## Failure and retry

Every process result other than exit status 0 keeps the modal open, including a startup error, nonzero exit, signal, timeout, or other interruption. Restore editing, preserve the exact message and selected decision, and show a Review Submission failure inside the modal. Identify the target, distinguish a startup failure, unsuccessful exit, and interruption, and show GitHub CLI stderr unchanged when present. If stderr is empty, show the exit status and a fallback message. When no exit status exists, identify how the process ended and state that submission success is unknown.

The footer changes the submit action to `Ctrl+S retry`. The user can retry unchanged, edit the message, change the decision, or cancel through the same safe-cancellation flow. Starting a retry clears the prior failure display. A failed submission does not refresh or otherwise change the Review Queue.

Do not retry automatically. Do not infer that a timed-out, interrupted, or otherwise failed process created a review. GitHub CLI exit status remains the success boundary.

## State boundary

The interaction can hold only temporary target, message, decision, focus, confirmation, validation, in-flight, and failure state. It must not create application-owned review progress or a reusable draft. GitHub remains the source of submitted review state and Review Queue membership.
