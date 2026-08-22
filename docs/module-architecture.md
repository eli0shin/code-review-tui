# Review CLI module architecture

## Decision

Keep true external dependencies behind two deep ports: `GitHub` and `Herdr`. Use production CLI adapters for GitHub and Herdr. Keep configuration, OpenTUI presentation, composition, and release operations outside those adapters.

The OpenTUI React Review Queue page owns its temporary presentation behavior. TanStack React Query owns remote Review Queue and detail data, status, polling, caching, and cancellation. The page keeps one local numeric Cursor and one temporary full-screen detail modal target. Its queue query loads on mount and polls every 60 seconds. Its details query loads independent source results on every modal opening and explicit refresh.

Do not add a session module, store, controller, event bus, state machine, scheduler service, queue, request-generation protocol, coalescing protocol, or presentation subscription interface. Add no coordination seam between the page and the external ports.

This shape keeps these concerns separate:

- GitHub CLI owns GitHub host, account, authentication, search, details, and Review Submission transport.
- The configuration module owns the XDG path, strict JSON validation, search tokenization, and effective key bindings.
- The OpenTUI Review Queue page owns temporary user-interface state and calls the configured ports directly.
- The Herdr module owns Review Command child data, Lumen launch checks, exact Herdr CLI calls, response parsing, and the best-effort Review Queue focus and created-tab close commands.
- The release module owns update checks, executable replacement, installer rules, and release assets.

## Dependency direction

```text
src/cli.tsx (composition root)
  ├── configuration
  ├── release
  └── runtime
       ├── github/cli-adapter ──> gh process
       ├── tools/herdr-adapter ─> herdr process
       └── presentation/opentui ─> GitHub + Herdr ports
```

Production adapters can import domain types, but domain modules cannot import adapters. The OpenTUI page receives configured port instances and effective key bindings from the composition root. It does not receive GitHub search tokens, Review Command text, Herdr CLI response data, or release settings.

## Shared domain values

Put stable application values in `src/domain/`:

- `PullRequestSummary`, identified by its canonical `url`, including row-level file, change, label, and comment metadata;
- `PullRequestDetails`, checks, issue comments, reviews, and inline review comments, all immutable detail values;
- `ReviewDecision`: `comment`, `approve`, or `requestChanges`;
- `ReviewSubmission`, with a captured target, exact message, and decision.

These are data values, not active objects. Do not put GitHub CLI JSON, Herdr CLI JSON, OpenTUI key events, or update state in these types.

The configured search order is the Review Queue order. A pull request URL identifies the target for detail loading, Review Submission, Lumen, and the Review Command.

## Module interfaces

### 1. Configuration

**Target path:** `src/configuration/`

```ts
type ConfigurationFailure = {
  readonly file: string;
  readonly field?: string;
  readonly problem: string;
};

type ReviewConfiguration = {
  readonly githubSearch: readonly string[];
  readonly reviewCommand: string;
  readonly keyBindings: EffectiveKeyBindings;
  readonly update: UpdateConfiguration;
};

function loadReviewConfiguration(): Promise<
  Result<ReviewConfiguration, ConfigurationFailure>
>;
```

The module hides XDG path selection, file reading, strict JSON validation, search tokenization without shell evaluation, key normalization and collision checks, and defaults. The returned search is already tokenized. The returned Review Command is the exact configured string.

The release module can read only optional updater settings through a separate tolerant function. `review update`, version output, help, and the detached updater worker must not require complete TUI configuration.

Use the real file system in configuration contract tests with a temporary HOME. Do not add a file-system port only for tests.

### 2. GitHub

**Target paths:** `src/github/types.ts`, `src/github/cli-adapter.ts`

```ts
interface GitHub {
  loadReviewQueue(signal: AbortSignal): Promise<GitHubResult<ReviewQueue>>;
  loadPullRequestDetails(
    url: string,
    signal: AbortSignal
  ): Promise<PullRequestDetailSources>;
  submitReview(
    submission: ReviewSubmission,
    signal: AbortSignal
  ): Promise<GitHubResult<void>>;
}
```

The GitHub CLI adapter hides exact `gh` arguments, process input and output, JSON validation, domain conversion, and operation-specific failures. It loads pull request metadata, reviews, checks, issue comments, and review threads independently so each source keeps its own success or complete diagnostic. It starts `gh` directly from `PATH` without a shell. It inherits the environment and does not set authentication values. It enriches each search result with `gh pr view` file and change counts at bounded concurrency before it publishes the complete Review Queue. Review Submission writes the exact UTF-8 message to stdin and closes stdin.

Construct the adapter with tokenized GitHub search from configuration. Page tests use a small in-memory `GitHub` implementation. Adapter tests put a recording `gh` executable first in `PATH`.

### 3. Herdr

**Target paths:** `src/tools/types.ts`, `src/tools/herdr-adapter.ts`

```ts
interface Herdr {
  openLumen(pullRequest: PullRequestSummary): Promise<HerdrResult>;
  openReviewCommand(pullRequest: PullRequestSummary): Promise<HerdrResult>;
}
```

Construct the adapter with the exact Review Command, startup working directory, inherited child environment, and Herdr CLI environment. Require Herdr workspace and Review Queue Tab IDs from that environment. There is no Herdr connection to start or stop.

For each action, execute explicit `herdr tab create`, `herdr pane run`, and `herdr tab focus` commands. Parse only the created tab and root pane IDs from the tab-create JSON. The pane command runs either `lumen diff PULL_REQUEST_URL` or `/bin/sh -c CONFIGURED_REVIEW_COMMAND`. After that process returns, the tab shell makes best-effort CLI calls to focus the saved Review Queue Tab and close the created tab. Semicolons keep each cleanup attempt independent of the prior command result.

Add the specified `REVIEW_PR_*` values to the Review Command Herdr tab environment. Do not add a public tool ID or track a running phase. Return the first immediate CLI or JSON failure. A failure does not disable later calls.

Test the adapter with a recording fake `herdr` executable. Prove exact calls, JSON parsing, immediate failure, later calls after failure, and the appended best-effort Review Queue focus and created-tab close commands. Prove that the close attempt occurs when focus fails.

### 4. OpenTUI Review Queue page

**Target path:** `src/presentation/`

```ts
function mountReviewPresentation(
  renderer: CliRenderer,
  github: GitHub,
  herdr: Herdr,
  keyBindings: EffectiveKeyBindings
): MountedPresentation;
```

TanStack React Query owns:

- the last complete Review Queue and pull request details;
- pending, error, and success status;
- the fixed 60-second Review Queue refetch interval;
- request cancellation through the query function's supplied `AbortSignal`.

The page keeps one local numeric Cursor and clamps its rendered position to the current queue rows. `openDetails` captures the pull request URL under the Cursor as temporary modal state. The Cursor has no pull request identity, and queue replacement does not preserve a URL. The modal refetches all detail sources on each opening and explicit refresh. Closing it restores the unchanged Review Queue and Cursor.

Configure TanStack Query's public `environmentManager` for the long-lived non-browser OpenTUI runtime before mounting queries. The queue query loads on mount, sets `refetchInterval: 60_000`, and uses `refetch()` for `r`. Do not add fetch effects, timer effects, pull request identity for the Cursor, request generations, or another remote-state layer.

Queue bindings run only while the Review Queue owns input. The full-screen details modal owns all input and maps the effective line, page, start, end, refresh, error, and quit actions to its one scrolling buffer. The Review Submission modal blocks queue actions. Herdr tabs never send input through OpenTUI because Herdr owns their terminals and focus.

Use one color language for all OpenTUI surfaces. The detected terminal background and foreground are the baseline for the Review Queue, details, help, Review Submission, status, and diagnostics. Reuse the Review Queue semantic accents on those surfaces. Keep the highlighted-row background exclusive to the row under the Cursor; do not derive another panel, modal, editor, or overlay surface color.

Use OpenTUI's test renderer. Test queue loading on mount, `r`, and the 60-second refetch interval; query cancellation on unmount; Cursor movement; captured modal targets; complete independent detail loading on every opening; configurable scrolling; key bindings; and visible query statuses through the page. Use in-memory port implementations. Do not create a separate page-state contract or orchestration object.

### 5. Composition root and runtime lifecycle

**Target paths:** `src/cli.tsx`, `src/runtime.ts`

The composition root performs this order for the TUI command:

1. load and validate complete TUI configuration;
2. route updater settings to release behavior;
3. validate Herdr context and create the Herdr CLI adapter with the exact Review Command;
4. create the GitHub CLI adapter with tokenized search;
5. create the OpenTUI renderer and mount the Review Queue page with both ports and effective key bindings.

Mounting the page subscribes its queries, which starts the initial Review Queue load and query-owned polling. A failure before mounting prints one actionable startup error and exits nonzero.

The runtime exits the `review` process immediately for quit, end-of-input, or a termination signal. It does not close Herdr tabs. There is no Herdr shutdown call, and Herdr continues to own launched commands.

### 6. Release

**Current paths:** `src/auto-update.ts`, `src/update.ts`, `src/update-state.ts`, `src/updater-worker.ts`, `src/commands/update.ts`, `install.sh`, and `.github/workflows/`

Release behavior is a sibling of the TUI runtime. Only `src/cli.tsx` composes it with command parsing. The updater can read optional updater settings, but it must not require GitHub search, a Review Command, Herdr, `gh`, or OpenTUI.

Keep artifact naming in one release function and verify that the installer, updater, and release workflow use the same four names.

## Contract suites

### Configuration contract

Use temporary XDG and HOME directories. Prove path selection, complete validation, search tokenization, normalized key collisions, exact Review Command preservation, defaults, and updater-only reads.

### GitHub CLI adapter contract

Use a recording fake `gh` process. Prove exact arguments and environment, complete JSON validation and conversion, failure classes, Review Submission input, and no shell or authentication mutation.

### Herdr CLI adapter contract

Use a recording fake `herdr` executable. Prove exact Lumen and Review Command calls, inherited and pull request environment, tab-create JSON parsing, immediate failures, later calls after failure, and the appended best-effort Review Queue focus and created-tab close commands. Prove that semicolon sequencing attempts close after a focus failure.

Do not model or review focus races or event-ordering races.

### OpenTUI page contract

Render the page and send terminal input. Prove:

- pull request loading on page open, `r`, and each 60-second query refetch;
- query cancellation on unmount;
- queue results, Cursor movement, captured modal targets, and refetch on every opening;
- complete detail content, independent failures, and configurable modal scrolling;
- pending, error, success, empty, and detail surfaces;
- effective key bindings and help text;
- Review Submission behavior and modal input isolation;
- Herdr actions and visible immediate CLI failures.

These are page tests. Do not reproduce the removed session-level coordination tests.

### Executable smoke contract

Build the native executable and use recording `gh` and `herdr` executables at their real process seams. Prove only critical composition paths: startup ordering, a valid initial Review Queue, command independence from TUI configuration, and immediate process termination without closing Herdr tabs. Do not duplicate page scenarios.

### Release contract

Keep release tests independent from TUI tests. Prove supported platform mapping, installer behavior, updater replacement failures, artifact URL agreement, and the `src/cli.tsx` build root.

## Implementation slices

1. Complete strict configuration and its contract tests.
2. Add domain values and the GitHub CLI adapter contract.
3. Build Review Queue and detail queries with TanStack React Query and keep one numeric Cursor in the OpenTUI page.
4. Add Review Submission state and actions directly to that page.
5. Add the `Herdr` port and recording fake-CLI contract.
6. Connect page tool actions and immediate failures directly to `Herdr`.
7. Complete the Review Queue layout and Review Submission modal.
8. Compose startup and shutdown, then add the small executable smoke suite.
9. Validate release and installer contracts against the completed executable.

Add a seam only when its production and test adapters both exist. Do not add an application-state coordination layer.

## Accepted limits

- GitHub and Herdr CLI output fields are compatibility seams. Report incompatibility; do not add fallback parsers or protocols.
- Review Queue, Cursor, details, and Review Submission draft are memory-only page state.
- Herdr owns Herdr tab terminals. OpenTUI owns only the Review Queue presentation.
- Best-effort cleanup is an appended Review Queue focus command followed by a created-tab close command.
- Release update state is the only application state in the XDG state area.
