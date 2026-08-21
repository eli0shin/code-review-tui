# GitHub data refresh and failure behavior

## Decision

The Review Queue is the last complete, successful result from the configured GitHub search. The application does not combine that result with local review status, hidden-item lists, or optimistic changes.

The selected pull request is temporary interface state. Its URL identifies it across Review Queue replacements. It is not durable workflow state.

## Review Queue loading

Load the Review Queue in these cases only:

1. when the application starts;
2. when the user requests a refresh; and
3. immediately after a successful Review Submission.

Do not poll in the background. Returning from Lumen or the Review Command does not imply that GitHub changed, so it does not cause an automatic refresh. The user can request one.

Use the `gh search prs` invocation and JSON shape in the [GitHub CLI integration contract](research/github-cli-integration-contract.md). Preserve the order from GitHub CLI. Do not sort or filter results in the application.

Only one Review Queue load can be active. If another automatic or user request arrives during that load, remember one pending request and run it after the active load ends. More requests do not create more pending loads. This makes a submission-triggered refresh take effect without starting concurrent GitHub CLI commands.

A load is atomic:

- Keep the current Review Queue visible while a refresh is active.
- Replace it only after GitHub CLI exits successfully and the complete JSON array passes validation.
- Treat malformed JSON, a non-array result, or any item without a required field as a failed load. Do not display a partial result.
- An empty valid array is a successful load and an empty Review Queue.

The loading indicator must distinguish the initial load, which has no Review Queue to show, from a refresh, which keeps the current Review Queue usable.

## Selection after a successful load

Use the pull request URL as selection identity.

- On the first successful non-empty load, select the first result.
- When replacing a non-empty Review Queue, keep the selected URL if it is still present.
- If the selected URL is absent, select the first result. Do not infer a successor from the prior row position.
- When the new Review Queue is empty, clear the selection and pull request details.

A failed load does not change the Review Queue or selection. Selection is not written to disk and is reset when the application starts.

## Pull request details

Load details after a pull request becomes selected. Starting any detail load cancels or makes obsolete the prior detail request, even when the selected URL is unchanged. A late result from a superseded request must not replace the details for the current selection.

After a successful Review Queue refresh, reload details for the resulting selection, including when its URL did not change. Keep the prior details visible as stale data while this reload is active. Clear them only when the resulting selection is empty or has a different URL.

A detail failure affects only the detail pane. Keep the Review Queue and selection usable, show the failure in that pane, and let the user retry by refreshing or reselecting the pull request. Never remove a pull request because its details cannot load.

## Successful Review Submissions

GitHub CLI exit status 0 is the source of truth for submission success. Show success immediately and start a Review Queue refresh. Do not optimistically remove, mark, or reorder the submitted pull request.

The refreshed GitHub search decides whether the pull request remains in the Review Queue. It can remain because the configured search does not depend on review requests or because GitHub search has not indexed the Review Submission yet. If it remains, display it and preserve its selection. If the refresh fails, keep the prior Review Queue, even though it can still contain the successfully reviewed pull request, and show both facts: the Review Submission succeeded, but the Review Queue could not be refreshed.

A submission failure does not refresh or change the Review Queue.

## Pagination and result limits

Request `--limit 1000` and treat the one JSON array from `gh search prs` as one complete application-level result. GitHub CLI owns REST pagination. The application must not add page, cursor, or “load more” controls.

GitHub Search and GitHub CLI do not provide enough metadata in this command output to prove that a result was truncated or partial. Do not claim that all possible matches are present and do not show an unverified truncation warning. A user whose search can exceed 1,000 matches must narrow the configured search.

## Failure presentation

GitHub CLI remains responsible for host selection, authentication, authorization, API behavior, and repair instructions. The application reports failures but does not run authentication checks, switch accounts, retry with different arguments, or change GitHub CLI configuration.

Classify failures by operation so the user knows what did not complete:

- Review Queue load;
- pull request detail load; or
- Review Submission.

For each failure, show:

1. the failed operation and pull request identity when one applies;
2. whether the process could not start, exited unsuccessfully, or returned invalid data;
3. GitHub CLI stderr without rewriting it, when stderr is present; and
4. a direct retry action when the operation is retryable.

If the process cannot start, identify `gh` as the executable and include the operating-system error. If GitHub CLI exits unsuccessfully with empty stderr, include its exit status and a fallback message. A parse failure must say that GitHub CLI returned malformed JSON. A validation failure must say that GitHub CLI returned unexpected or incompatible data and identify the missing or invalid required field when possible. Do not display the full response because it can be large or contain unexpected data.

Keep each failure at its boundary:

- An initial Review Queue failure shows an unavailable state with refresh as retry.
- A refresh failure keeps the last successful Review Queue and marks it as not refreshed.
- A detail failure stays in the detail pane.
- A Review Submission failure stays in the submission interaction and preserves the user's message so it can be retried or edited.

A successful retry clears the corresponding failure. Starting a retry can clear an old success notice, but it must not hide the last usable GitHub data.

## State boundary

The application can keep temporary presentation state: the current Review Queue result, selected URL, loaded details, in-flight operation state, one pending refresh, and operation notices. None of this records review progress.

Do not persist or derive application-owned states such as reviewed, ready, diff viewed, Review Command run, hidden, snoozed, or failed before. GitHub data and the configured search are the only source of Review Queue membership.
