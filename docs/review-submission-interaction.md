# Review Submission interaction

## Decision

Compose one top-level Review Submission in a compact modal over the Review Queue. The modal contains one multiline message editor. It does not contain a decision selector and does not support file selection, line selection, pending reviews, or inline comments.

Opening the modal captures the pull request under the Cursor as its target. Later Cursor movement or detail updates cannot change that target. Show `OWNER/REPOSITORY #NUMBER` on the first line and the pull request title on the second line.

Only one Review Submission interaction can be open, and only one submission can be active.

## Layout

Use this order:

1. repository and pull request number;
2. pull request title;
3. one blank line;
4. one borderless multiline message editor that uses the available modal height;
5. one reserved status row; and
6. subdued action hints on the final modal row.

Do not show a `Review Submission` heading or explanatory editor text. Align the first editor character with the target text. Do not put blank space below the action hints.

Use a preferred width of 78 columns and a preferred height of 18 rows. Center the modal and reduce it to fit smaller terminals. The Review Queue remains an inert backdrop.

The editor owns input for the complete modal session. There is no editor-versus-decision focus state. Review Queue bindings do not run, and the Cursor does not move behind the modal.

## Controls

The controls inside this interaction are fixed and are not part of the configurable Review Queue key bindings:

- Printable input edits the message.
- `Enter` inserts a newline. It never submits.
- Normal editor navigation, selection, deletion, and paste controls remain available unless they conflict with the fixed review chords.
- `Ctrl+A` immediately submits Approve with the exact current message.
- `Ctrl+C` immediately submits Comment with the exact current message.
- `Ctrl+R` immediately submits Request Changes with the exact current message.
- `Escape` immediately closes the modal, aborts an active submission, and discards the draft without confirmation.

There is no selected decision and no separate submit action. The action chord supplies the decision and submits in one operation.

## Validation

A Comment or Request Changes message must contain at least one non-whitespace character. An Approve message can be empty.

Validate when the user presses a review chord. If validation fails, do not start GitHub CLI. Preserve the exact draft and show the requirement in the reserved status row. Editing clears the validation message.

Whitespace is ignored only to decide whether a required message is blank. Do not trim or otherwise rewrite a valid message before submission.

## In-flight behavior and cancellation

After submission starts, disable editing and ignore additional review chords until the GitHub CLI process ends. Show only the applicable progress message in the reserved status row:

- `Approving pull request …`
- `Submitting comment …`
- `Requesting changes …`

The idle status row contains one blank line so progress does not move the editor or action hints.

`Escape` remains active while submission is in flight. It closes the modal immediately, aborts the active GitHub CLI process, and prevents its later result from reopening or changing the modal. A closed or discarded draft is not saved and does not otherwise change the Review Queue.

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

## Failure

Every process result other than exit status 0 keeps the modal open unless the user closed it. Restore editing, preserve the exact message, and show the complete Review Submission failure in the reserved status area. Identify the target, distinguish a startup failure, unsuccessful exit, and interruption, and show GitHub CLI stderr unchanged when present. If stderr is empty, show the exit status and a fallback message. When no exit status exists, identify how the process ended and state that submission success is unknown.

Keep all three review chords available after failure. The user can retry the same action, choose another action, edit the message, or close immediately. Starting another submission clears the prior failure display. A failed submission does not refresh or otherwise change the Review Queue.

Never start another submission automatically. Do not infer that a timed-out, interrupted, or otherwise failed process created a review. GitHub CLI exit status remains the success boundary.

## State boundary

The interaction can hold only temporary target, message, current in-flight action, validation, failure, and process-control state. It must not create application-owned review progress or a reusable draft. GitHub remains the source of submitted review state and Review Queue membership.
