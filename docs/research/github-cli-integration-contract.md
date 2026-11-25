# GitHub CLI integration contract

Research date: 2026-08-21. Validated against the installed GitHub CLI 2.97.0. Reads moved to ghp 0.2.0 on 2026-11-21.

## Decision

Read GitHub through [ghp](https://github.com/eli0shin/gh-proxy) and write through GitHub CLI:

| Operation                          | Command                             |
| ---------------------------------- | ----------------------------------- |
| Load one cross-repository PR page  | `ghp search`                        |
| List the repositories in a search  | `gh api graphql`                    |
| Load pull request details          | `ghp pr details <pull-request-url>` |
| Create a Review Submission         | `gh pr review <pull-request-url>`   |
| Mark a reviewed pull request stale | `ghp invalidate <pull-request-url>` |

ghp keeps one GitHub cache shared by every process on the machine, including PR Watch sessions, and sends at most one batched request for each stale read. Many Review instances and agent sessions polling the same pull requests used to exhaust the GitHub GraphQL rate limit. Each read has a max age: a page up to 60 seconds old and details up to 15 seconds old are served from the cache. An explicit refresh (`r`) passes `--max-age 0`, which accepts only data fetched after the request.

Use the pull request `url` from the Review Queue as the identity passed to all later commands. A number is only unique inside one repository. The URL also contains the host, owner, repository, and number.

Do not call `gh auth`, read GitHub CLI configuration, or set authentication variables. Unscoped search inherits GitHub CLI's default host: ghp uses `GH_HOST`, else the only host GitHub CLI is signed in to, else github.com. Scoped search supplies the resolved repository host with `--host`. ghp reads each host's token with `gh auth token`. Inherit the user's environment and let `gh` select its default host and active account. `GH_HOST`, when the user has set it, selects a host where the command cannot infer one. `gh auth switch` controls the active account for a host.[^gh-environment][^gh-auth-switch]

This gives one cross-repository queue on the one host selected by GitHub CLI. A single GitHub search does not combine results from multiple hosts.

## Review Queue

### Invocation

Tokenize the configured search and serialize its terms using GitHub CLI's keyword quoting. Group the intact query before intersecting `type:pr` and optional repository scope. Do not evaluate it as a shell command.

```text
ghp search '( <serialized-search> ) type:pr [repo:OWNER/REPO]' \
  [--host <resolved-repository-host>] \
  --size 25 \
  [--after <page-start-cursor>] \
  [--max-age 0] \
  --consumer review
```

ghp runs `search(query:$query,type:ISSUE_ADVANCED,first:$size,after:$after)` and returns summary nodes plus `pageInfo { hasNextPage endCursor }`. Each node also carries the fields Review used to read with one `gh pr view` per row, so a page is one read. The page size is configured, from 1 to 100. `after` is omitted on page 1. My PRs substitutes `is:pr author:@me state:open`. GitHub Enterprise Server requires 3.18 or newer for advanced search.

For example, `label:"needs review"` tokenizes to `label:needs review` and serializes back to `label:"needs review"`. Terms without a colon are quoted as a whole when they contain whitespace or double quotes. Preserve intentionally grouped terms without variable, command, glob, or redirection expansion. The configuration contract specifies the tokenizer's quoting rules.

GraphQL search searches pull requests across the selected GitHub host. It accepts GitHub issue and pull request search syntax; the adapter intersects the query with the pull request type. Repository scope is optional, so the configured search can cover repositories from different owners.[^gh-search-prs]

A useful initial search is:

```text
review-requested:@me state:open
```

`review-requested:@me` includes requests to the active user and requests to a team that contains that user. GitHub removes a matching review request after that user or team reviews. If the intended queue must contain only direct requests, use `user-review-requested:@me` instead.[^github-pr-search]

The configured value is a search query, not extra `gh` options. It can contain terms, qualifiers, negated qualifiers, and supported Boolean syntax. Passing it as the value of `searchQuery` also permits a query that starts with a negated qualifier such as `-label:wip`.[^gh-search]

### Repository Filter

Each list's search can be intersected with a Repository Filter, after any repository scope:

```text
ghp search '( <serialized-search> ) type:pr [repo:OWNER/REPO] [repo:A | (repo:A OR repo:B)]' ...
```

Several `repo:` qualifiers separated by spaces would all have to match in advanced search, so several repositories are joined with `OR` in parentheses.

The Repository Filter panel lists every repository in the search without the filter. That needs every page, and the enriched `ghp search` costs about five rate-limit points and takes seconds for 100 rows. A search that asks only for each pull request's repository costs one point and returns in about half a second, so the panel reads GitHub directly instead of through ghp's shared cache:

```text
gh api graphql [--hostname <resolved-repository-host>] \
  -f query='query($searchQuery:String!,$after:String) { search(query:$searchQuery,type:ISSUE_ADVANCED,first:100,after:$after) { nodes { ... on PullRequest { repository { nameWithOwner } } } pageInfo { hasNextPage endCursor } } }' \
  -f searchQuery='( <serialized-search> ) type:pr [repo:OWNER/REPO]' \
  [-f after=<cursor>]
```

The adapter follows `endCursor` until `hasNextPage` is false. GitHub search stops after 1,000 results, so this takes at most 10 requests. It counts pull requests per `nameWithOwner` and skips nodes that are not pull requests. Review keeps the result in memory and reloads it once a minute while the list is shown.

### JSON contract

ghp prints one result: `{ "value": { "nodes", "pageInfo", "stacks" }, "fetchedAt", "stale", "error" }`. A result with a null `value` fails the load with `error` as its message. ghp exits 3 in that case and still prints the result. A value that failed to refresh (`stale` with an `error`) is still shown, so the queue stays usable while GitHub rate-limits requests. Validate `value.nodes`, `value.pageInfo`, and `value.stacks` atomically; reject missing page metadata. Use these summary node fields:

- `url`: canonical cross-repository and cross-host identity.
- `repository.nameWithOwner`: display repository, for example `cli/cli`.
- `number`, `title`, `author.login`, and `isDraft`: main row content.
- `state`, `createdAt`, and `updatedAt`: state and stable timestamps for display or ordering.
- `labels(first:100).nodes` and `comments.totalCount`: metadata shown on every row.
- `state`: normalize GraphQL's uppercase state to the existing lowercase row contract.
- `stack { number size entries(first:100) { nodes { pullRequest { url headRefName } } } }` and `stackEntry { position }`: GitHub native Stack membership. `stack` is null for a pull request outside a Stack. GitHub Enterprise Server schemas do not have these fields. ghp then repeats the search without them, remembers that for the host, and returns `stacks: false`; rows then have no Stack and no layers are pulled in. An entry's `pullRequest` can be null when the viewer cannot read that layer; skip it.
- `additions`, `deletions`, `changedFiles`, `reviewDecision` (empty when GitHub has none), `reviews`, and `statusCheckRollup`, in `gh pr view --json` shapes: the row's size, review status, and checks.

Summarize reviewer feedback from only the latest submitted review per reviewer (by submission time, ignoring pending reviews). An outstanding latest change request takes precedence over approvals; a later approval by the same reviewer replaces their earlier change request. This row summary describes reviewer feedback, not branch-protection eligibility. When there is no current approval or change request, retain GitHub's decision except that superseded approval/change-request decisions become `REVIEW_REQUIRED`. Preserve search order apart from grouping Stack layers, and publish the Review Queue only when every item passes validation.

Do not parse human-readable output.

### Pagination and limits

The previous `gh search prs --limit 1000` command eagerly traversed REST pages and emitted a flat array with no page metadata. Its limit is a total result cap, not a page size.[^gh-search-prs-source][^gh-searcher-source] It cannot implement bounded navigation without re-fetching earlier results, so paged loading uses GraphQL search through `gh api` instead.

Use GitHub's opaque end cursor only when `hasNextPage` is true. Reject missing or empty next cursors. Keep visited start cursors for previous-page navigation; never prefetch. Automatic refresh reuses the page start and manual refresh omits it. If a later page becomes empty, return to page 1. Only the active page's rows, including its pulled-in Stack layers, are loaded.

### Stack layers

GitHub search has no Stack qualifier: `stack:<number>` and `is:stacked` match nothing, and `in:stack` is ignored. Head branches work instead. For each Stack on the page with layers missing from this page and earlier pages, run the same search intersected with those layers' head branches:

```text
ghp search '( <serialized-search> ) type:pr [repo:OWNER/REPO] repo:STACK_OWNER/STACK_REPO (head:"<branch>" OR head:"<branch>")' --size 100
```

Quote every branch name: an unquoted `(` or `)` in a branch makes the whole OR group match nothing. `head:` matches branch names that start with the term and fork branches with the same name, so `head:"patch-1"` also returns `patch-18`. Ask for a full page of 100 to leave room for those matches, and keep only results whose URL is one of the requested layers. GitHub accepted a query of 31 `head:` terms and about 1,100 characters on github.com (validated 2026-10-07).

GraphQL search exposes at most 1,000 results; pagination does not bypass this boundary. Narrower queries are the remedy. See [GraphQL search](https://docs.github.com/en/graphql/reference/queries#search) and [advanced API search support](https://github.blog/changelog/2025-03-06-github-issues-projects-api-support-for-issues-advanced-search-and-more/). Do not replace this with `gh pr list`: that command lists one repository.

## Pull request details

Load all details with one read by the captured canonical pull request URL:

```text
ghp pr details <url> [--max-age 0] --consumer review
```

The result's `value` holds `metadata` (the `gh pr view --json number,title,body,author,state,isDraft,url,createdAt,updatedAt,baseRefName,headRefName,additions,deletions,changedFiles,labels,reviewDecision,reviewRequests` shape), `reviews`, `statusCheckRollup`, and `comments` (the matching `gh pr view --json` shapes), and `reviewThreads`. ghp follows every connection to its end: reviews, comments, check contexts, review threads, and each thread's comments. Each review thread carries `id`, `isResolved`, `diffSide`, `startDiffSide`, and all of its comments. Each comment includes its file path, line or range, reply relationship, and outdated state. For an outdated comment whose current line fields are null, use `originalLine` and `originalStartLine` so its original location remains visible. When GitHub returns a null inline-comment author for a deleted account, display the established `ghost` label and keep the remaining thread source available.

Treat metadata, reviews, checks, issue comments, and review threads as five independent results. A failed read fails all five with the same diagnostics, but an invalid source must not discard the other valid sources. Preserve complete diagnostics on that source. The presentation groups inline comments by review thread and combines successful issue comments, reviews, and review threads by timestamp, placing each review thread at its first comment.

The details fields have these uses:

- Metadata provides identity, refs, labels, change totals, description, review decision, and requested reviewers.
- `reviews` provides the latest submitted review per reviewer for the Reviewers summary and all submitted-review conversation entries, including reviews with empty bodies. Keep older reviews in conversation history; do not discard them in the adapter.
- `statusCheckRollup` provides only each check name and terminal state or current status.
- `comments` provides all issue comments.
- Review threads provide inline comments and their complete line, reply, resolved, and outdated context.

The adapter preserves all body strings exactly and does not parse Markdown. The Pull Request Details modal passes GitHub-authored bodies to OpenTUI's Markdown renderer.

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

A successful non-TTY invocation has no required response payload. Use exit status 0 as success. Then run `ghp invalidate <pull-request-url>`, so the refresh that follows, and every other process, reads the pull request again instead of serving its cached state. The submission succeeded whether or not that command does. On failure, preserve GitHub CLI's stderr for the user. GitHub CLI and GitHub remain responsible for authorization rules, such as whether the active account can approve that pull request.

This contract creates one top-level Review Submission. It does not create pending reviews or inline comments, which are outside this application's scope.

## Host, authentication, and account boundary

The application must:

1. Start `ghp` and `gh` from `PATH`.
2. Inherit the user's environment.
3. Pass the serialized configured search, page cursor, and the pull request URL under the Cursor only as data arguments.
4. Parse `ghp` stdout after exit status 0 or 3, and `gh` stdout only after exit status 0.
5. Show actionable command startup, authentication, API, parsing, and submission errors without trying to repair GitHub CLI configuration.

ghp gets the token for each request's host from `gh auth token`, so GitHub CLI's active account stays the account Review uses. Detail and submission commands infer the host from the target URL. This keeps host, credentials, and account selection with GitHub CLI while still supporting GitHub Enterprise hosts that provide the required search syntax and APIs.

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
