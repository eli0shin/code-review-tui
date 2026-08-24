# GitHub data refresh and failure behavior

## Decision

The Review Queue is the last complete, successful result from the configured GitHub search. The application does not combine that result with local review status, hidden-item lists, or optimistic changes.

The Cursor is temporary interface state. It is a numeric position that highlights one visible Review Queue row and has no pull request identity.

## Review Queue loading

Load the Review Queue in these cases only:

1. when the Review Queue page mounts;
2. when the user requests a refresh with `r`;
3. every 60 seconds while the page is mounted; and
4. immediately after a successful Review Submission.

Returning from Lumen or the Review Command does not imply that GitHub changed, so it does not cause an additional refresh.

Use the `gh search prs` invocation and JSON shape in the [GitHub CLI integration contract](research/github-cli-integration-contract.md). Preserve the order from GitHub CLI. Do not sort or filter results in the application.

TanStack React Query owns request deduplication, polling, status, caching, and cancellation. Do not add an application refresh queue, pending-load state, or request coordination.

A load is atomic:

- Keep the current Review Queue visible while a refresh is active.
- Replace it only after the search and every bounded-concurrency row-metadata enrichment exit successfully and all JSON passes validation.
- Treat malformed JSON, a non-array result, or any item without a required field as a failed load. Do not display a partial result.
- An empty valid array is a successful load and an empty Review Queue.

Render pending, error, and success from query status. During a refetch, keep the current successful Review Queue usable.

## Cursor after a successful load

Render exactly the latest successful Review Queue result. Keep one numeric Cursor and clamp its rendered position to the current rows.

- The Cursor starts at row `0`.
- Arrow keys move it only within the currently rendered rows.
- A successful queue load replaces the rows without preserving a pull request URL.
- When the Review Queue is empty, no row is highlighted and the details query is disabled.

A failed load does not change the last successful Review Queue. The Cursor is not written to disk and resets when the page mounts.

## Pull request details

Details load only after `openDetails` captures the URL under the Cursor. Keep one React Query details query keyed by that captured URL while the full-screen modal is open. Refetch all independent detail sources on every opening and on the modal refresh action. Cached successful content can remain visible during the refetch. Closing the modal disables the query and returns to the unchanged Review Queue and Cursor.

The adapter returns independent metadata, reviews, checks, issue-comment, and review-thread results. Publish each success or failure without making one failed source hide another. Merge every successful conversation source by timestamp. Render the pull request description and each successful conversation body with OpenTUI Markdown while metadata and inline code context remain ordinary text. The modal shows concise unavailable markers. Its `showErrors` action opens the existing bounded error surface with complete unchanged diagnostics for all failed sources and returns to the same modal scroll position when closed.

A Review Queue refresh does not invalidate details. Queue and detail loading remain independent. Never remove a pull request because one of its detail sources cannot load.

## Successful Review Submissions

GitHub CLI exit status 0 is the source of truth for submission success. Show success immediately and start a Review Queue refresh. Do not optimistically remove, mark, or reorder the submitted pull request.

The refreshed GitHub search decides whether the pull request remains in the Review Queue. It can remain because the configured search does not depend on review requests or because GitHub search has not indexed the Review Submission yet. If the refresh fails, keep the prior Review Queue, even though it can still contain the successfully reviewed pull request, and show both facts: the Review Submission succeeded, but the Review Queue could not be refreshed.

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

Keep queue and detail diagnostics inline when they fit in the available rendered rows at the current terminal width. Diagnostics that do not fit open a focused, bounded error surface. Arrow keys, Page Up, Page Down, Home, and End make the complete unchanged stderr reachable. Escape returns to the Review Queue. While this surface owns input, Review Queue actions do not run, except that the effective refresh binding retries the Review Queue load.

Keep each failure at its boundary:

- An initial Review Queue failure shows an unavailable state with refresh as retry.
- A refresh failure keeps the last successful Review Queue and marks it as not refreshed.
- A detail-source failure stays in the details modal as a concise marker; complete diagnostics stay in its error surface.
- A Review Submission failure stays in the submission interaction and preserves the user's message. The submission controls do not change, and the application does not start another submission automatically.

A successful retry clears the corresponding failure. Starting a retry can clear an old success notice, but it must not hide the last usable GitHub data.

## State boundary

TanStack React Query keeps temporary Review Queue and detail data, status, caching, cancellation, and operation failures. The page keeps one local numeric Cursor, one temporary modal target, its scroll position, and other local interaction values that do not represent remote data. None of this records review progress.

Do not persist or derive application-owned states such as reviewed, ready, diff viewed, Review Command run, hidden, snoozed, or failed before. GitHub data and the configured search are the only source of Review Queue membership.
