# Review CLI module architecture

## Decision

Keep true external dependencies behind two deep ports: `GitHub` and `ToolTabs`. Use production adapters for GitHub CLI and Herdr. Keep configuration, OpenTUI presentation, composition, and release operations outside those adapters.

The OpenTUI React Review Queue page owns its temporary presentation behavior. TanStack React Query owns remote Review Queue and detail data, status, polling, caching, and cancellation. The page keeps one local numeric Cursor. Its queue query loads on mount, polls every 60 seconds, and exposes `refetch()` for `r`.

Do not add a session module, store, controller, event bus, state machine, scheduler service, queue, request-generation protocol, coalescing protocol, or presentation subscription interface. Add no coordination seam between the page and the external ports.

This shape keeps these concerns separate:

- GitHub CLI owns GitHub host, account, authentication, search, details, and Review Submission transport.
- The configuration module owns the XDG path, strict JSON validation, search tokenization, and effective key bindings.
- The OpenTUI Review Queue page owns temporary user-interface state and calls the configured ports directly.
- The Tool Tabs module owns Review Command child data, Lumen launch checks, Herdr requests, tool lifecycle, best-effort focus restoration, and cleanup.
- The release module owns update checks, executable replacement, installer rules, and release assets.

## Dependency direction

```text
src/cli.tsx (composition root)
  ├── configuration
  ├── release
  └── runtime
       ├── github/cli-adapter ──> gh process
       ├── tools/herdr-adapter ─> Herdr socket
       └── presentation/opentui ─> GitHub + ToolTabs ports
```

Production adapters can import domain types, but domain modules cannot import adapters. The OpenTUI page receives configured port instances and effective key bindings from the composition root. It does not receive GitHub search tokens, Review Command text, Herdr protocol values, or release settings.

## Shared domain values

Put stable application values in `src/domain/`:

- `PullRequestSummary`, identified by its canonical `url`;
- `PullRequestDetails`, also identified by `url`;
- `ReviewDecision`: `comment`, `approve`, or `requestChanges`;
- `ReviewSubmission`, with a captured target, exact message, and decision;
- application-level tool notices.

These are data values, not active objects. Do not put GitHub CLI JSON, Herdr resource IDs, OpenTUI key events, or update state in these types.

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
  ): Promise<GitHubResult<PullRequestDetails>>;
  submitReview(
    submission: ReviewSubmission,
    signal: AbortSignal
  ): Promise<GitHubResult<void>>;
}
```

The GitHub CLI adapter hides exact `gh` arguments, process input and output, JSON validation, domain conversion, and operation-specific failures. It starts `gh` directly from `PATH` without a shell. It inherits the environment and does not set authentication values. Review Submission writes the exact UTF-8 message to stdin and closes stdin.

Construct the adapter with tokenized GitHub search from configuration. Page tests use a small in-memory `GitHub` implementation. Adapter tests put a recording `gh` executable first in `PATH`.

### 3. Tool Tabs

**Target paths:** `src/tools/types.ts`, `src/tools/herdr-adapter.ts`

```ts
type ToolKind = 'lumen' | 'reviewCommand';

type ToolRequest = {
  readonly kind: ToolKind;
  readonly pullRequest: PullRequestSummary;
};

interface ToolTabs {
  launch(request: ToolRequest): Promise<ToolLaunchOutcome>;
  acknowledgeIndeterminateLaunch(toolId: ToolId): void;
  subscribe(listener: (notice: ToolNotice) => void): () => void;
  shutdown(reason: ShutdownReason): Promise<ToolShutdownOutcome>;
}
```

Construct the adapter with the exact Review Command, startup working directory, inherited environment, verified Herdr context, and control transport. The adapter keeps Herdr identifiers and protocol state private.

For Lumen, it builds exactly:

```text
["lumen", "diff", PULL_REQUEST_URL]
```

For the Review Command, it builds exactly:

```text
["/bin/sh", "-c", CONFIGURED_REVIEW_COMMAND]
```

It adds the specified `REVIEW_PR_*` values and `REVIEW_TOOL_ID` to the child environment. `/bin/sh` performs normal shell expansion after launch.

On an ordinary matching `pane.exited` event, make one focus request for the saved Review Queue pane. Do not add state, protocol operations, tests, or review criteria for focus races or event-ordering races.

Test the adapter against a small fake Unix socket server that implements only the accepted Herdr v0.8.2 messages.

### 4. OpenTUI Review Queue page

**Target path:** `src/presentation/`

```ts
function mountReviewPresentation(
  renderer: CliRenderer,
  github: GitHub,
  toolTabs: ToolTabs,
  keyBindings: EffectiveKeyBindings
): MountedPresentation;
```

TanStack React Query owns:

- the last complete Review Queue and pull request details;
- pending, error, and success status;
- the fixed 60-second Review Queue refetch interval;
- request cancellation through the query function's supplied `AbortSignal`.

The page keeps one local numeric Cursor and clamps its rendered position to the current queue rows. The pull request under the Cursor supplies the details query URL. The Cursor has no pull request identity, and queue replacement does not preserve a URL. Queue refetch does not invalidate details for an unchanged URL under the Cursor.

Configure TanStack Query's public `environmentManager` for the long-lived non-browser OpenTUI runtime before mounting queries. The queue query loads on mount, sets `refetchInterval: 60_000`, and uses `refetch()` for `r`. Do not add fetch effects, timer effects, pull request identity for the Cursor, request generations, or another remote-state layer.

Queue bindings run only while the Review Queue owns input. The Review Submission modal blocks queue actions. Tool Tabs never send input through OpenTUI because Herdr owns their PTYs and focus.

Use OpenTUI's test renderer. Test query loading on mount, `r`, and the 60-second refetch interval; query cancellation on unmount; Cursor movement; detail loading for the highlighted row; key bindings; and visible query statuses through the page. Use in-memory port implementations. Do not create a separate page-state contract or orchestration object.

### 5. Composition root and runtime lifecycle

**Target paths:** `src/cli.tsx`, `src/runtime.ts`

The composition root performs this order for the TUI command:

1. load and validate complete TUI configuration;
2. route updater settings to release behavior;
3. validate Herdr and create the Tool Tabs adapter with the exact Review Command;
4. create the GitHub CLI adapter with tokenized search;
5. create the OpenTUI renderer and mount the Review Queue page with both ports and effective key bindings.

Mounting the page subscribes its queries, which starts the initial Review Queue load and query-owned polling. A failure before mounting prints one actionable startup error and exits nonzero.

One runtime lifecycle function coordinates quit, end-of-input, Review Queue pane loss, and signals with Tool Tab shutdown, presentation unmount, and renderer destruction. Tool ownership and pane cleanup stay inside `ToolTabs`. Presentation unmount removes query observers and cancels active query work.

### 6. Release

**Current paths:** `src/auto-update.ts`, `src/update.ts`, `src/update-state.ts`, `src/updater-worker.ts`, `src/commands/update.ts`, `install.sh`, and `.github/workflows/`

Release behavior is a sibling of the TUI runtime. Only `src/cli.tsx` composes it with command parsing. The updater can read optional updater settings, but it must not require GitHub search, a Review Command, Herdr, `gh`, or OpenTUI.

Keep artifact naming in one release function and verify that the installer, updater, and release workflow use the same four names.

## Contract suites

### Configuration contract

Use temporary XDG and HOME directories. Prove path selection, complete validation, search tokenization, normalized key collisions, exact Review Command preservation, defaults, and updater-only reads.

### GitHub CLI adapter contract

Use a recording fake `gh` process. Prove exact arguments and environment, complete JSON validation and conversion, failure classes, Review Submission input, and no shell or authentication mutation.

### Tool Tabs adapter contract

Use a fake Herdr v0.8.2 socket. Prove startup checks, exact process descriptions and environment, Lumen repository checks, ownership, lifecycle notices, indeterminate launch acknowledgement, shutdown, and one best-effort focus request after an ordinary observed exit.

Do not model or review focus races or event-ordering races.

### OpenTUI page contract

Render the page and send terminal input. Prove:

- pull request loading on page open, `r`, and each 60-second query refetch;
- query cancellation on unmount;
- queue results, Cursor movement, and detail loading for the highlighted row;
- pending, error, success, empty, and detail surfaces;
- effective key bindings and help text;
- Review Submission behavior and modal input isolation;
- tool actions and visible notices.

These are page tests. Do not reproduce the removed session-level coordination tests.

### Executable smoke contract

Build the native executable and use recording `gh` and Herdr adapters at their real process and socket seams. Prove only critical composition paths: startup ordering, a valid initial Review Queue, command independence from TUI configuration, and owned termination cleanup. Do not duplicate page scenarios.

### Release contract

Keep release tests independent from TUI tests. Prove supported platform mapping, installer behavior, updater replacement failures, artifact URL agreement, and the `src/cli.tsx` build root.

## Implementation slices

1. Complete strict configuration and its contract tests.
2. Add domain values and the GitHub CLI adapter contract.
3. Build Review Queue and detail queries with TanStack React Query and keep one numeric Cursor in the OpenTUI page.
4. Add Review Submission state and actions directly to that page.
5. Add Tool Tabs and the Herdr fake-server contract.
6. Connect page tool actions and lifecycle notices directly to `ToolTabs`.
7. Complete the Review Queue layout and Review Submission modal.
8. Compose startup and shutdown, then add the small executable smoke suite.
9. Validate release and installer contracts against the completed executable.

Add a seam only when its production and test adapters both exist. Do not add an application-state coordination layer.

## Accepted limits

- GitHub CLI output fields and Herdr v0.8.2 protocol behavior are compatibility seams. Report incompatibility; do not add fallback parsers or protocols.
- Review Queue, Cursor, details, Review Submission draft, and tool lifecycle data are memory-only page state.
- Herdr owns Tool Tab terminals. OpenTUI owns only the Review Queue presentation.
- Best-effort Review Queue focus restoration stops after one focus request for an ordinary observed tool exit.
- Release update state is the only application state in the XDG state area.
