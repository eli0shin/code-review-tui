# GitHub CLI integration contract

Research date: 2026-08-21. Validated against the installed GitHub CLI 2.97.0.

## Decision

Use GitHub CLI as the complete GitHub boundary:

| Operation                              | Command                           |
| -------------------------------------- | --------------------------------- |
| Load the cross-repository Review Queue | `gh search prs`                   |
| Load pull request details              | `gh pr view <pull-request-url>`   |
| Create a Review Submission             | `gh pr review <pull-request-url>` |

Use the pull request `url` from the Review Queue as the identity passed to all later commands. A number is only unique inside one repository. The URL also contains the host, owner, repository, and number.

Do not call `gh auth`, read GitHub CLI configuration, supply `--hostname` or `--repo`, or set any `GH_*` authentication variable. Inherit the user's environment and let `gh` select its default host and active account. `GH_HOST`, when the user has set it, selects a host where the command cannot infer one. `gh auth switch` controls the active account for a host.[^gh-environment][^gh-auth-switch]

This gives one cross-repository queue on the one host selected by GitHub CLI. A single GitHub search does not combine results from multiple hosts.

## Review Queue

### Invocation

Tokenize the configured search into query arguments, place them after `--`, and do not evaluate them as a shell command:

```text
gh search prs \
  --json number,title,author,isDraft,state,createdAt,updatedAt,url,repository \
  --limit 1000 \
  -- \
  <configured-search-argument>...
```

For example, `review-requested:@me state:open` must become two arguments. Passing that complete string as one argument makes GitHub CLI quote it as one qualifier value and produces a different, invalid query. The tokenizer must preserve intentionally quoted terms but must not perform variable, command, glob, or redirection expansion. The configuration contract must specify the exact quoting rules.

`gh search prs` searches pull requests across the selected GitHub host. It accepts GitHub issue and pull request search syntax and adds the pull request type itself. Repository scope is optional, so the configured search can cover repositories from different owners.[^gh-search-prs]

A useful initial search is:

```text
review-requested:@me state:open
```

`review-requested:@me` includes requests to the active user and requests to a team that contains that user. GitHub removes a matching review request after that user or team reviews. If the intended queue must contain only direct requests, use `user-review-requested:@me` instead.[^github-pr-search]

The configured value is a search query, not extra `gh` options. It can contain terms, qualifiers, negated qualifiers, and supported Boolean syntax. Passing it after `--` also permits a query that starts with a negated qualifier such as `-label:wip`.[^gh-search]

### JSON contract

The command emits one JSON array. Use these fields:

- `url`: canonical cross-repository and cross-host identity.
- `repository.nameWithOwner`: display repository, for example `cli/cli`.
- `number`, `title`, `author.login`, and `isDraft`: main row content.
- `state`, `createdAt`, and `updatedAt`: state and stable timestamps for display or ordering.

GitHub CLI documents all available search fields as `assignees`, `author`, `authorAssociation`, `body`, `closedAt`, `commentsCount`, `createdAt`, `id`, `isDraft`, `isLocked`, `isPullRequest`, `labels`, `number`, `repository`, `state`, `title`, `updatedAt`, and `url`.[^gh-search-prs] In GitHub CLI 2.97.0, `repository` is normalized to `{name, nameWithOwner}` and `author` includes `login`; this is part of the command's JSON exporter rather than the raw REST response.[^gh-search-export]

Do not parse the command's human-readable output. `--json` is GitHub CLI's supported machine-readable output mode.[^gh-formatting]

### Pagination and limits

`--limit` is the total result limit, not a page size. Its default is 30 and its accepted range is 1 through 1,000. GitHub CLI requests up to 100 items per REST page and follows the API's `Link` header until it reaches the requested limit or there is no next page.[^gh-search-prs-source][^gh-searcher-source] GitHub Search exposes no more than 1,000 results for one search.[^github-rest-search]

Therefore:

- Use `--limit 1000` to get the largest Review Queue snapshot that this command can provide.
- Treat stdout as one complete array. Do not implement page or cursor controls around this command.
- A queue with more than 1,000 matches is truncated by the GitHub Search boundary. A narrower configured search is the remedy.
- The `gh search prs --json` exporter emits only result items. It does not emit the REST response's `total_count` or `incomplete_results`, so the application cannot reliably mark a snapshot as truncated or timed out.[^gh-search-output-source]
- Search is rate-limited separately, and GitHub can return partial results after a search timeout. Refresh behavior must keep and report command failures as specified by the later refresh contract.[^github-rest-search]

Do not replace this with `gh pr list`: that command lists one repository. Do not replace it with raw `gh api search/issues` unless the application needs search response metadata enough to own raw API normalization and pagination.

## Pull request details

Load details by URL:

```text
gh pr view <pull-request-url> \
  --json number,title,body,author,state,isDraft,url,createdAt,updatedAt,baseRefName,headRefName,additions,deletions,changedFiles,labels,reviewDecision,reviewRequests,latestReviews
```

`gh pr view` accepts a full URL and supports these fields. It also supports fields such as `comments`, `reviews`, `files`, `commits`, `statusCheckRollup`, merge state, and repository metadata if a later UI contract needs them.[^gh-pr-view]

Passing the URL is important. GitHub CLI parses its host, owner, repository, and pull request number, then sends the detail query to that host.[^gh-pr-finder] No local checkout and no `--repo` value are necessary.

Request only fields that the details view displays:

- `reviews` and `comments` make `gh pr view` follow their GraphQL connections until complete, in pages of 100.[^gh-pr-pagination]
- Other nested collections are not uniformly unbounded. For example, the 2.97.0 query asks for at most 100 `reviewRequests`, `latestReviews`, or `files`.[^gh-pr-query-builder]
- Scalar totals such as `changedFiles`, `additions`, and `deletions` do not have that collection truncation problem.

The proposed details field set uses `latestReviews` for a concise current-review summary. Add full `reviews` only if the interaction design later requires review history.

## Review Submission

### Invocation

Use one explicit, non-interactive command for each decision. Send the message through standard input so multiline text is preserved and does not become a command-line argument:

```text
# Comment; message must not be blank
gh pr review <pull-request-url> --comment --body-file -

# Approve; message can be blank
gh pr review <pull-request-url> --approve --body-file -

# Request changes; message must not be blank
gh pr review <pull-request-url> --request-changes --body-file -
```

Write the Review Submission message to stdin and then close stdin. For an approval with no message, either send empty stdin or omit `--body-file -`. Never invoke `gh pr review` without one of the three decision flags: without a flag it can prompt when attached to a terminal and fails in non-interactive mode.[^gh-pr-review][^gh-pr-review-source]

GitHub CLI enforces exactly one decision flag. It also rejects blank comment and request-changes bodies. Its implementation resolves the URL and sends an `addPullRequestReview` GraphQL mutation with `APPROVE`, `REQUEST_CHANGES`, or `COMMENT`.[^gh-pr-review-source][^gh-add-review] These decisions match GitHub's create-review API. GitHub also documents that `COMMENT` and `REQUEST_CHANGES` require a body.[^github-rest-reviews]

A successful non-TTY invocation has no required response payload. Use exit status 0 as success. On failure, preserve GitHub CLI's stderr for the user. GitHub CLI and GitHub remain responsible for authorization rules, such as whether the active account can approve that pull request.

This contract creates one top-level Review Submission. It does not create pending reviews or inline comments, which are outside this application's scope.

## Host, authentication, and account boundary

The application must:

1. Start `gh` from `PATH`.
2. Inherit the user's environment.
3. Pass the tokenized configured search and the pull request URL under the Cursor only as data arguments.
4. Parse stdout only after exit status 0.
5. Show actionable command startup, authentication, API, parsing, and submission errors without trying to repair GitHub CLI configuration.

The search implementation asks GitHub CLI configuration for its default host. GitHub CLI's HTTP transport then chooses the active token for each request's host.[^gh-search-host][^gh-http-auth] Detail and submission commands infer the host from the target URL. This keeps host, credentials, and account selection outside the application while still supporting GitHub Enterprise hosts that provide the required search syntax and APIs.

## Compatibility boundary

The command names and flags are stable public GitHub CLI interfaces, but JSON field availability can change with GitHub CLI versions. At startup or first use, a missing command, unsupported field, invalid configured search, or unauthenticated host must be reported as a GitHub CLI integration error. The application must not silently fall back to human-readable output.

## Sources

[^gh-search-prs]: GitHub CLI manual, [`gh search prs`](https://cli.github.com/manual/gh_search_prs).

[^gh-pr-view]: GitHub CLI manual, [`gh pr view`](https://cli.github.com/manual/gh_pr_view).

[^gh-pr-review]: GitHub CLI manual, [`gh pr review`](https://cli.github.com/manual/gh_pr_review).

[^gh-formatting]: GitHub CLI manual, [JSON formatting](https://cli.github.com/manual/gh_help_formatting).

[^gh-search]: GitHub CLI manual, [`gh search` and negated qualifiers](https://cli.github.com/manual/gh_search).

[^gh-environment]: GitHub CLI manual, [environment variables](https://cli.github.com/manual/gh_help_environment).

[^gh-auth-switch]: GitHub CLI manual, [`gh auth switch`](https://cli.github.com/manual/gh_auth_switch).

[^github-pr-search]: GitHub Docs, [searching issues and pull requests: review status and reviewer](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests#search-by-pull-request-review-status-and-reviewer).

[^github-rest-search]: GitHub Docs, [REST API endpoints for search](https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28#about-search).

[^github-rest-reviews]: GitHub Docs, [create a review for a pull request](https://docs.github.com/en/rest/pulls/reviews?apiVersion=2022-11-28#create-a-review-for-a-pull-request).

[^gh-search-prs-source]: GitHub CLI 2.97.0 source, [`pkg/cmd/search/prs/prs.go`](https://github.com/cli/cli/blob/v2.97.0/pkg/cmd/search/prs/prs.go#L74-L80).

[^gh-searcher-source]: GitHub CLI 2.97.0 source, [`pkg/search/searcher.go`](https://github.com/cli/cli/blob/v2.97.0/pkg/search/searcher.go#L162-L187).

[^gh-search-output-source]: GitHub CLI 2.97.0 source, [`pkg/cmd/search/shared/shared.go`](https://github.com/cli/cli/blob/v2.97.0/pkg/cmd/search/shared/shared.go#L58-L94).

[^gh-search-export]: GitHub CLI 2.97.0 source, [`pkg/search/result.go`](https://github.com/cli/cli/blob/v2.97.0/pkg/search/result.go#L403-L443).

[^gh-search-host]: GitHub CLI 2.97.0 source, [`pkg/cmd/search/shared/shared.go`](https://github.com/cli/cli/blob/v2.97.0/pkg/cmd/search/shared/shared.go#L41-L55).

[^gh-pr-finder]: GitHub CLI 2.97.0 source, [`pkg/cmd/pr/shared/finder.go`](https://github.com/cli/cli/blob/v2.97.0/pkg/cmd/pr/shared/finder.go#L112-L123) and [`ParseURL`](https://github.com/cli/cli/blob/v2.97.0/pkg/cmd/pr/shared/finder.go#L303-L328).

[^gh-pr-pagination]: GitHub CLI 2.97.0 source, [`pkg/cmd/pr/shared/finder.go`](https://github.com/cli/cli/blob/v2.97.0/pkg/cmd/pr/shared/finder.go#L267-L278) and [`preloadPrReviews`](https://github.com/cli/cli/blob/v2.97.0/pkg/cmd/pr/shared/finder.go#L440-L477).

[^gh-pr-query-builder]: GitHub CLI 2.97.0 source, [`api/query_builder.go`](https://github.com/cli/cli/blob/v2.97.0/api/query_builder.go#L101-L145).

[^gh-pr-review-source]: GitHub CLI 2.97.0 source, [`pkg/cmd/pr/review/review.go`](https://github.com/cli/cli/blob/v2.97.0/pkg/cmd/pr/review/review.go#L66-L132).

[^gh-add-review]: GitHub CLI 2.97.0 source, [`api/queries_pr_review.go`](https://github.com/cli/cli/blob/v2.97.0/api/queries_pr_review.go#L249-L276).

[^gh-http-auth]: GitHub CLI 2.97.0 source, [`api/http_client.go`](https://github.com/cli/cli/blob/v2.97.0/api/http_client.go#L148-L170).
