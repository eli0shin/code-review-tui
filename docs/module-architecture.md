# Review CLI module architecture

## Decision

Build `review` around one deep application module, `ReviewSession`. Its interface is the test surface for Review Queue behavior. Put true external dependencies behind two ports: `GitHub` and `ToolTabs`. Use production adapters for GitHub CLI and Herdr, and in-memory adapters in application tests.

Keep configuration, OpenTUI presentation, and release operations outside `ReviewSession`. The executable entry point is the composition root. It routes search tokens to the GitHub adapter, the Review Command to the Tool Tabs adapter, effective key bindings to presentation, and updater settings to release behavior. It then creates `ReviewSession` with only the two configured ports.

This shape keeps these concerns separate:

- GitHub CLI owns GitHub host, account, authentication, search, details, and Review Submission transport.
- The configuration module owns the XDG path, strict JSON validation, search tokenization, and effective key bindings.
- `ReviewSession` owns all temporary Review Queue and Review Submission behavior.
- The Tool Tabs module owns Review Command child data, Lumen launch checks, Herdr requests, tool lifecycle, best-effort focus restoration, and cleanup.
- The OpenTUI module owns terminal rendering and translation between key events and semantic actions.
- The release module owns update checks, executable replacement, installer rules, and release assets.

Do not add a general process runner, repository layer, event bus, or state-store interface. These abstractions would expose implementation details without adding leverage.

## Dependency direction

```text
src/cli.tsx (composition root)
  ├── configuration
  ├── release
  └── runtime
       ├── github/cli-adapter ──> gh process
       ├── tools/herdr-adapter ─> Herdr socket
       ├── review-session ──────> GitHub + ToolTabs ports
       └── presentation/opentui ─> ReviewSession interface
```

Dependencies point toward domain types and the `ReviewSession` interface. `ReviewSession` does not import React, OpenTUI, Bun process types, Herdr protocol types, file-system types, or release code. Production adapters can import domain types, but domain modules cannot import adapters.

## Shared domain values

Put stable application values in `src/domain/`:

- `PullRequestSummary`, identified by its canonical `url`;
- `PullRequestDetails`, also identified by `url`;
- `ReviewDecision`: `comment`, `approve`, or `requestChanges`;
- `ReviewSubmission`, with a captured target, exact message, and decision;
- semantic queue actions and application notices.

These are data values, not active objects. Do not put GitHub CLI JSON, Herdr resource IDs, OpenTUI key events, or update state in these types.

The configured search order is the Review Queue order. A pull request URL is the only identity used across queue replacement, detail loading, Review Submission, Lumen, and the Review Command.

## Module interfaces

### 1. Configuration

**Target path:** `src/configuration/`

**Interface:**

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

The module hides:

- selection of `$XDG_CONFIG_HOME/review/config.json` or the HOME fallback;
- file reading and JSON parsing;
- strict unknown-field and type checks;
- required TUI fields;
- GitHub search tokenization without shell evaluation;
- key descriptor normalization and collision checks;
- application of omitted key-binding and updater defaults.

The returned search is already tokenized. Callers cannot accidentally pass one quoted query argument or evaluate it as shell text. The returned Review Command is the exact configured string.

The release module can read only the optional updater settings through a separate tolerant function. `review update`, version output, help, and the detached updater worker must not require complete TUI configuration.

Use the real file system in configuration contract tests with a temporary HOME. Do not add a file-system port only for tests.

### 2. GitHub

**Target paths:** `src/github/types.ts`, `src/github/cli-adapter.ts`

**Port:**

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

The GitHub CLI adapter hides:

- exact `gh search prs`, `gh pr view`, and `gh pr review` argument lists;
- process start, stdout, stderr, stdin, exit, and interruption handling;
- JSON parsing and complete shape validation;
- conversion from GitHub CLI data to domain values;
- operation-specific failures.

`GitHubResult` distinguishes process startup, unsuccessful exit, interruption, malformed JSON, and incompatible data. It keeps stderr unchanged when stderr exists. It does not expose a Bun subprocess.

The adapter starts `gh` directly from `PATH`, without a shell. It inherits the environment and does not read or set GitHub authentication values. Review Submission writes the exact UTF-8 message to stdin and closes stdin.

Construct the production adapter with the tokenized GitHub search from configuration. `ReviewSession` depends on the resulting port and does not receive the search or other configuration. Its tests use an in-memory adapter with controllable promises. GitHub CLI adapter tests put a recording `gh` executable first in `PATH`; this verifies the process seam without a shallow spawn-wrapper interface.

### 3. Tool Tabs

**Target paths:** `src/tools/types.ts`, `src/tools/herdr-adapter.ts`

**Port:**

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

Construct the production adapter with the exact configured Review Command, startup working directory, inherited environment, verified Herdr context, and control transport. Do not pass these values on each launch.

The port exposes an application-level tool ID, kind, target, phase, and notices. An indeterminate notice includes the tool ID. `ReviewSession` uses that ID to acknowledge the retry risk through `acknowledgeIndeterminateLaunch`. Acknowledgement clears only the adapter's retry safety interlock. It does not stop the creation watch, discard ownership, or prove that the request ended.

The port does not expose pane, tab, workspace, terminal, socket, request, event sequence, or process identifiers. Those values are private Herdr adapter state.

The adapter hides:

- startup validation of the compatible Herdr session;
- one persistent event subscription and fresh request connections;
- direct-process `layout.apply` creation and ownership correlation;
- launch states, including indeterminate launch;
- stable terminal ID reconciliation;
- Lumen repository-marker validation and argv construction;
- Review Command argv and environment construction;
- pane-only shutdown and confirmation;
- best-effort Review Queue focus restoration.

For Lumen, the adapter builds exactly:

```text
["lumen", "diff", PULL_REQUEST_URL]
```

For the Review Command, it builds exactly:

```text
["/bin/sh", "-c", CONFIGURED_REVIEW_COMMAND]
```

It adds the specified `REVIEW_PR_*` values and `REVIEW_TOOL_ID` to the child environment. It does not expand the Review Command. `/bin/sh` performs normal shell expansion after launch.

On an ordinary matching `pane.exited` event, make one focus request for the saved Review Queue pane. This is the accepted best-effort seam. Do not add state, protocol operations, tests, or review criteria for focus races or event-ordering races. A stale pane ID can cause one snapshot update, but it does not cause another focus attempt for that exit.

The Herdr adapter is a deep module. Keep socket framing and protocol request helpers private to it. Test its external interface against a small fake Unix socket server that implements only the accepted Herdr v0.8.2 messages.

### 4. ReviewSession

**Target path:** `src/session/`

**Interface:**

```ts
interface ReviewSession {
  start(): Promise<void>;
  getSnapshot(): ReviewSnapshot;
  dispatch(action: ReviewAction): void;
  subscribe(listener: () => void): () => void;
  shutdown(reason: ShutdownReason): Promise<ShutdownOutcome>;
}
```

Create it only with the configured `GitHub` and `ToolTabs` ports. It does not receive configuration. `dispatch` accepts semantic actions such as select next, refresh, open Lumen, open the Review Command, acknowledge an indeterminate tool launch, open or edit a Review Submission, submit, cancel, confirm discard, and quit. It does not accept raw terminal key events.

`ReviewSnapshot` is immutable presentation data. It includes:

- the last complete Review Queue;
- selected URL and details state;
- initial-load or refresh state;
- Review Submission modal state;
- operation notices and failures;
- tool launch notices;
- shutdown state.

The module hides all state transitions and operation coordination:

- one active Review Queue load plus one coalesced pending load;
- atomic queue replacement and URL-based selection preservation;
- detail cancellation or obsolescence and stale-detail rules;
- modal target capture, validation, discard confirmation, in-flight lock, and retry;
- post-submission refresh without optimistic queue changes;
- launch safety notices, user acknowledgement of an indeterminate launch, and shutdown coordination.

Internal reducers, request tokens, and state machines are implementation details. They are not separate public modules. Test them through `ReviewSession`; do not test past this interface.

`ReviewSession` does not record durable review progress. Restarting it resets the Review Queue result, selection, details, drafts, tool notices, and operation state.

### 5. OpenTUI presentation

**Target path:** `src/presentation/`

**Interface:**

```ts
function mountReviewPresentation(
  renderer: CliRenderer,
  session: ReviewSession,
  keyBindings: EffectiveKeyBindings
): MountedPresentation;
```

The presentation reads snapshots, renders them, and dispatches semantic actions. It owns:

- the GitHub-style Review Queue layout and semantic terminal colors;
- detail-pane, loading, empty, error, notice, help, and shutdown surfaces;
- modal widgets and focus placement;
- translation of effective queue key bindings to actions;
- fixed Review Submission editor and decision controls;
- React mount and unmount.

The presentation does not call `gh`, read configuration, create Tool Tabs, expand the Review Command, decide refresh ordering, or retain a second copy of application state. Widget-local cursor and selection data can remain in OpenTUI when it has no domain meaning.

Queue bindings run only while the Review Queue owns input. The Review Submission modal blocks queue actions. Tool Tabs never send input through OpenTUI because Herdr owns their PTYs and focus.

Use OpenTUI's test renderer to test key-to-action mapping, modal input ownership, persistent decision marks, and the main visual states. Use `ReviewSession` snapshots or a narrow fake session; do not construct GitHub or Herdr adapters in presentation tests.

### 6. Composition root and runtime lifecycle

**Target paths:** `src/cli.tsx`, `src/runtime.ts`

The composition root performs this order for the TUI command:

1. load and validate complete TUI configuration;
2. route updater settings to release behavior;
3. validate Herdr and create the Tool Tabs adapter with the exact Review Command;
4. create the GitHub CLI adapter with the tokenized search;
5. create `ReviewSession` with only the `GitHub` and `ToolTabs` ports;
6. create the OpenTUI renderer and mount presentation with the effective key bindings;
7. start the session, which starts the initial Review Queue load.

A failure before mounting prints one actionable startup error and exits nonzero. It does not start later dependencies.

One runtime lifecycle function coordinates quit, end-of-input, Review Queue pane loss, and signals with `ReviewSession.shutdown()`, presentation unmount, and renderer destruction. Tool ownership and pane cleanup stay inside `ToolTabs`. OpenTUI resource cleanup stays inside the mounted presentation. The composition root orders these operations but does not duplicate them.

### 7. Release

**Current paths:** `src/auto-update.ts`, `src/update.ts`, `src/update-state.ts`, `src/updater-worker.ts`, `src/commands/update.ts`, `install.sh`, and `.github/workflows/`

Release behavior is a sibling of the TUI runtime, not a dependency of `ReviewSession`, GitHub, Tool Tabs, or presentation.

Its executable interfaces are:

- schedule a detached stable update check and optionally return a notice;
- run the explicit `review update` command;
- run the private updater-worker entry point.

Only `src/cli.tsx` composes release behavior with command parsing. The updater can read optional updater settings, but it must not require GitHub search, a Review Command, Herdr, `gh`, or OpenTUI.

Keep artifact naming in one release function and verify that the installer, updater, and release workflow use the same four names. A release asset is the compiled composition root; no runtime module has release-workflow knowledge.

## End-to-end contract suites

The following suites cross meaningful seams. Small pure helpers can have focused tests, but these suites are the main confidence boundary.

### Configuration contract

Call `loadReviewConfiguration` with temporary XDG and HOME directories. Prove:

- XDG and HOME fallback selection;
- complete valid configuration and defaults;
- every startup error class with file, field, and problem;
- exact search tokenization, including quoted empty segments and failures;
- normalized key collisions;
- exact preservation of the opaque Review Command;
- updater-only reads without required TUI fields.

### GitHub CLI adapter contract

Run the adapter with a recording fake `gh` process. Prove:

- exact search and detail argv and inherited environment;
- complete JSON validation and domain conversion;
- startup, exit, stderr, malformed-data, and incompatible-data failures;
- exact Review Submission argv;
- exact multiline stdin, including empty approval input;
- no shell, host flag, repository flag, or authentication mutation.

### Tool Tabs adapter contract

Run `ToolTabs` against a fake Herdr v0.8.2 socket and temporary working directories. Prove:

- startup context checks before launch;
- exact Lumen and Review Command process descriptions;
- exact child environment replacement without parent mutation;
- repository-marker checks for Lumen;
- adoption, lifecycle notice, disconnect reconciliation, an indeterminate notice with its tool ID, and acknowledgement that clears only the retry interlock;
- ownership of only created panes;
- concurrent pane closure and shutdown confirmation;
- one best-effort focus request after an ordinary observed exit.

Do not model or review focus races or event-ordering races. The contract ends at the one focus request.

### ReviewSession contract

Use controllable in-memory `GitHub` and `ToolTabs` adapters. Prove complete user scenarios:

1. initial load, first selection, and detail load;
2. refresh with the old queue visible, atomic replacement, and URL selection preservation;
3. failed refresh with prior queue and selection unchanged;
4. coalescing many refresh requests into one pending load;
5. late details never replacing current details;
6. successful Review Submission closing the modal and starting refresh;
7. failed Review Submission preserving the exact target, message, and decision for retry;
8. safe discard and fixed validation rules;
9. Lumen and Review Command actions using the captured selected pull request;
10. no refresh or review-progress state after a tool ends;
11. irreversible shutdown, rejected new actions, and delegated Tool Tab cleanup.

These tests assert snapshots, adapter calls, and final outcomes. They do not assert reducer fields, request-token values, or method call order that has no contract meaning.

### OpenTUI presentation contract

Render snapshots with the OpenTUI test renderer and send terminal input. Prove:

- Review Queue selection and semantic row styling;
- initial, refresh, empty, stale-detail, and operation-failure surfaces;
- effective queue key bindings and help text;
- modal input isolation and fixed editor controls;
- decision selection that does not depend on color;
- disabled editing and cancellation during submission;
- shutdown progress and cleanup-failed surfaces.

### Executable smoke contract

Build the native executable and run it in a controlled process environment with recording `gh` and Herdr adapters at their real process and socket seams. Prove only the critical composition paths:

- invalid TUI configuration fails before Herdr, GitHub CLI, and OpenTUI startup;
- invalid Herdr context fails before the initial GitHub load;
- a valid startup reaches the initial Review Queue;
- `review update`, `--help`, and `--version` do not require TUI configuration or Herdr;
- a termination request enters the owned cleanup path.

Do not duplicate every session scenario in executable tests.

### Release contract

Keep release tests independent from TUI tests. Prove:

- supported operating-system and architecture mapping;
- glibc installer checks and atomic destination replacement;
- updater download and executable replacement failures;
- exact agreement among updater URLs, installer URLs, and four workflow artifact names;
- release workflow build targets the same `src/cli.tsx` composition root.

## Implementation slices

Implement in vertical slices so every slice ends at an observable interface:

1. Replace configuration parsing with the complete strict configuration interface and its contract tests.
2. Add domain values and the GitHub CLI adapter with queue, detail, and submission contract tests.
3. Add `ReviewSession` queue and detail behavior with an in-memory GitHub adapter.
4. Add Review Submission behavior through the same session interface.
5. Add Tool Tabs and the Herdr fake-server contract, including Review Command child data and shutdown.
6. Connect tool actions and lifecycle notices to `ReviewSession`.
7. Build the OpenTUI Review Queue and modal against session snapshots and actions.
8. Compose startup and shutdown, then add the small executable smoke suite.
9. Validate release and installer contracts against the completed executable.

Do not create all folders and ports before the first vertical behavior exists. Add a seam when its production and test adapters both exist.

## Accepted limits

- GitHub CLI output fields and Herdr v0.8.2 protocol behavior are compatibility seams. Report incompatibility; do not add fallback parsers or protocols.
- Review Queue, selection, details, Review Submission draft, and tool lifecycle data are memory-only.
- Herdr owns Tool Tab terminals. OpenTUI owns only the Review Queue presentation.
- Best-effort Review Queue focus restoration stops after one focus request for an ordinary observed tool exit. Race-free focus restoration is not part of the interface, implementation plan, or test plan.
- Release update state is the only application state in the XDG state area. It is not Review Queue or review-progress state.
