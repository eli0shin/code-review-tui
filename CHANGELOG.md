# code-review-tui

## 0.9.1

### Patch Changes

- [#71](https://github.com/eli0shin/code-review-tui/pull/71) [`1388471`](https://github.com/eli0shin/code-review-tui/commit/13884715d2bdef3a1de4ec7ecfce501cd5660a0f) Thanks [@eli0shin](https://github.com/eli0shin)! - Restructure the Review Queue presentation and GitHub CLI adapter into focused modules without changing review behavior.

## 0.9.0

### Minor Changes

- [#69](https://github.com/eli0shin/code-review-tui/pull/69) [`bdb03c6`](https://github.com/eli0shin/code-review-tui/commit/bdb03c64119d5a45a05a14d7e2ca9a610bf9658a) Thanks [@eli0shin](https://github.com/eli0shin)! - Show which pull requests belong to a GitHub stack. Each stacked row shows `stack 3/4` after its number, and a stack's layers are listed together where the stack first appears, highest layer first. When a page has one layer, Review also loads the stack's other layers that match the same search, without repeating them on later pages.

## 0.8.1

### Patch Changes

- [#67](https://github.com/eli0shin/code-review-tui/pull/67) [`9b2468b`](https://github.com/eli0shin/code-review-tui/commit/9b2468b1054ca87f557b79c11da77ffe28f4ca4f) Thanks [@eli0shin](https://github.com/eli0shin)! - Stop showing a lasting notice above the pull request list after a successful Review Submission. A refresh failure after submission now appears the same as any other refresh failure.

## 0.8.0

### Minor Changes

- [#65](https://github.com/eli0shin/code-review-tui/pull/65) [`f7c773b`](https://github.com/eli0shin/code-review-tui/commit/f7c773b3d472d1b79642477e8f641edb4cc6dfd7) Thanks [@eli0shin](https://github.com/eli0shin)! - Load pull request searches one page at a time to reduce startup time and GitHub API requests. Navigate with `n` / `p` and configure `github.pageSize` (default 25). Manual refresh starts at page 1; automatic refresh keeps the current page's start cursor and returns to page 1 if that page becomes empty.

- [#64](https://github.com/eli0shin/code-review-tui/pull/64) [`a41226f`](https://github.com/eli0shin/code-review-tui/commit/a41226fa4bfe7f405ef4678fbb64e9f855f7d3d1) Thanks [@eli0shin](https://github.com/eli0shin)! - Show saved source context for inline review threads, with line numbers, colored diff gutters, and emphasized commented ranges. Keep existing source separate from suggested changes in comment bodies.

  Improve Review Queue and help layout, distinguish conversation comments, add theme-based Markdown and code colors, and give code blocks full-width backgrounds with consistent spacing. Hide encoded Vercel deployment metadata without removing readable deployment content.

## 0.7.0

### Minor Changes

- Add a configurable `l` toggle to scope the Review Queue and My PRs to the GitHub repository where Review launched. Scope starts off and stays separate from saved and session-edited queries.

## 0.6.0

### Minor Changes

- [#62](https://github.com/eli0shin/code-review-tui/pull/62) [`d78b03a`](https://github.com/eli0shin/code-review-tui/commit/d78b03a7fe465a1f60c143d87f16af1492569e56) Thanks [@eli0shin](https://github.com/eli0shin)! - Press `/` in the Review Queue to edit its active GitHub search for the current TUI session. Enter applies and immediately refetches; Escape cancels. Refreshes keep using the override, My PRs stays unchanged, and restarting restores the configured query without saving edits.

## 0.5.0

### Minor Changes

- [#61](https://github.com/eli0shin/code-review-tui/pull/61) [`d7af9c2`](https://github.com/eli0shin/code-review-tui/commit/d7af9c2a5c63633b208834e1c7442d57ad9d19e3) Thanks [@eli0shin](https://github.com/eli0shin)! - Make the active pull request list refresh interval configurable with `github.refreshIntervalMinutes`. The default is five minutes instead of one minute to reduce GitHub API requests for large Review Queues.

### Patch Changes

- [#60](https://github.com/eli0shin/code-review-tui/pull/60) [`b75689f`](https://github.com/eli0shin/code-review-tui/commit/b75689ff9d30820c9c1bb84889d824d310c80fe4) Thanks [@eli0shin](https://github.com/eli0shin)! - Show one centered fetching message while the Review Queue or My PRs loads, and center status details when a list is empty or unavailable.

- [#58](https://github.com/eli0shin/code-review-tui/pull/58) [`0d5d69d`](https://github.com/eli0shin/code-review-tui/commit/0d5d69d0607349992957808c6a99c81a966fb319) Thanks [@eli0shin](https://github.com/eli0shin)! - Show `Diff` and `Review` instead of `Diff Command` and `Review Command` in Herdr tab labels.

## 0.4.0

### Minor Changes

- [#56](https://github.com/eli0shin/code-review-tui/pull/56) [`fc2bbc8`](https://github.com/eli0shin/code-review-tui/commit/fc2bbc8d4ec1f5b39a09857af5c0a36d3fca12c4) Thanks [@eli0shin](https://github.com/eli0shin)! - Add an optional `diffCommand` setting that replaces Lumen for `openDiff`. The Diff Command runs through `/bin/sh -c` in a Herdr tab and receives the same `REVIEW_PR_*` variables as the Review Command. Use it to show the merge-base pull request diff, because Lumen compares the base branch tip with the head.

## 0.3.0

### Minor Changes

- [#54](https://github.com/eli0shin/code-review-tui/pull/54) [`d947cfa`](https://github.com/eli0shin/code-review-tui/commit/d947cfacf2eb98ccd4da6dca6639a752519fe2cb) Thanks [@eli0shin](https://github.com/eli0shin)! - Switch between the Review Queue and open PRs authored by the active GitHub user.

## 0.2.13

### Patch Changes

- [#52](https://github.com/eli0shin/code-review-tui/pull/52) [`eeee687`](https://github.com/eli0shin/code-review-tui/commit/eeee687f1e54bc2d7f74e13edf472d24bb198956) Thanks [@eli0shin](https://github.com/eli0shin)! - Show terminal-aware highlighting for selected pull request detail text.

## 0.2.12

### Patch Changes

- [#50](https://github.com/eli0shin/code-review-tui/pull/50) [`d6a6bfa`](https://github.com/eli0shin/code-review-tui/commit/d6a6bfaa51b170467d9bb319a17cbf99f9f94b82) Thanks [@eli0shin](https://github.com/eli0shin)! - Copy completed mouse selections from pull request details to the clipboard.

## 0.2.11

### Patch Changes

- [#48](https://github.com/eli0shin/code-review-tui/pull/48) [`05f98b7`](https://github.com/eli0shin/code-review-tui/commit/05f98b7acb11b7f0cda122c1feaf0979011b1264) Thanks [@eli0shin](https://github.com/eli0shin)! - Add a configurable `openInBrowser` Review Queue action, mapped to `b` by default, that opens the pull request under the Cursor in the user's default browser.

## 0.2.10

### Patch Changes

- [#46](https://github.com/eli0shin/code-review-tui/pull/46) [`ff395b6`](https://github.com/eli0shin/code-review-tui/commit/ff395b666d2757271751236164dab58a1a1ad4d5) Thanks [@eli0shin](https://github.com/eli0shin)! - Stabilize Pull Request Details modal close coverage for release publication.

## 0.2.9

### Patch Changes

- [#44](https://github.com/eli0shin/code-review-tui/pull/44) [`d02ac4b`](https://github.com/eli0shin/code-review-tui/commit/d02ac4b7cf6445cba8ef307d3936cc92e45717ab) Thanks [@eli0shin](https://github.com/eli0shin)! - Render GitHub-authored pull request detail bodies with OpenTUI Markdown.

## 0.2.8

### Patch Changes

- [#42](https://github.com/eli0shin/code-review-tui/pull/42) [`4824b84`](https://github.com/eli0shin/code-review-tui/commit/4824b84a2a726cb4789c80451ff6c69288fc6b60) Thanks [@eli0shin](https://github.com/eli0shin)! - Run the Lumen capture and cleanup script through POSIX sh so it works from fish-backed Herdr panes.

## 0.2.7

### Patch Changes

- [#39](https://github.com/eli0shin/code-review-tui/pull/39) [`c32e879`](https://github.com/eli0shin/code-review-tui/commit/c32e8790c1e112677e1f24320013d888f352c43b) Thanks [@eli0shin](https://github.com/eli0shin)! - Capture sent Lumen comments at the pull request's deterministic temporary path.

- [#40](https://github.com/eli0shin/code-review-tui/pull/40) [`1e58d39`](https://github.com/eli0shin/code-review-tui/commit/1e58d396c5574a871438d6b6ff2bd59a1a9d6658) Thanks [@eli0shin](https://github.com/eli0shin)! - Add `review skill install` to install the user-invoked review-comments Agent Skill.

## 0.2.6

### Patch Changes

- [#37](https://github.com/eli0shin/code-review-tui/pull/37) [`a9488cf`](https://github.com/eli0shin/code-review-tui/commit/a9488cf0eb887c127b92e1de3a2b67905f2ae751) Thanks [@eli0shin](https://github.com/eli0shin)! - Replace Review Submission decision focus and confirmation flows with direct approve, comment, request-changes, and discard chords in an editor-first modal.

## 0.2.5

### Patch Changes

- [#35](https://github.com/eli0shin/code-review-tui/pull/35) [`9622da8`](https://github.com/eli0shin/code-review-tui/commit/9622da83706c77e5367bdd33d9cf9f9b25dd1a29) Thanks [@eli0shin](https://github.com/eli0shin)! - Use the Pull Request List terminal colors for details, help, Review Submission, status, and diagnostic surfaces.

## 0.2.4

### Patch Changes

- [#33](https://github.com/eli0shin/code-review-tui/pull/33) [`2ab7238`](https://github.com/eli0shin/code-review-tui/commit/2ab72386d5a424fa5900d45f53fdf5e50eb5be61) Thanks [@eli0shin](https://github.com/eli0shin)! - Make the configurable details page actions scroll by half of the current visible viewport.

## 0.2.3

### Patch Changes

- [#32](https://github.com/eli0shin/code-review-tui/pull/32) [`3bd014f`](https://github.com/eli0shin/code-review-tui/commit/3bd014fbc897784640d41d663b1ff2e63a3a7d01) Thanks [@eli0shin](https://github.com/eli0shin)! - Replace the fixed pull request details pane with a full-screen, scrollable details modal that includes reviewers, checks, description, and the complete review conversation.

- [#30](https://github.com/eli0shin/code-review-tui/pull/30) [`f730db7`](https://github.com/eli0shin/code-review-tui/commit/f730db758ce751c8f733091b781fd984aff775a8) Thanks [@eli0shin](https://github.com/eli0shin)! - Close each Lumen or Review Command Herdr tab after its command completes.

## 0.2.2

### Patch Changes

- [#27](https://github.com/eli0shin/code-review-tui/pull/27) [`687a8d1`](https://github.com/eli0shin/code-review-tui/commit/687a8d1b3ec7b52c98cdc4e05bf5563cb655c722) Thanks [@eli0shin](https://github.com/eli0shin)! - Generate a valid positional Pi Review Command in new configuration files.

## 0.2.1

### Patch Changes

- [#24](https://github.com/eli0shin/code-review-tui/pull/24) [`6b8e27d`](https://github.com/eli0shin/code-review-tui/commit/6b8e27d35cf92552d8d7b986a1ec8bb70ebe7279) Thanks [@eli0shin](https://github.com/eli0shin)! - Create a complete editable Review configuration during the first TUI startup.

## 0.2.0

### Minor Changes

- [#22](https://github.com/eli0shin/code-review-tui/pull/22) [`53cba29`](https://github.com/eli0shin/code-review-tui/commit/53cba2909ff580766b6fe3c474b430eba75c9c4d) Thanks [@eli0shin](https://github.com/eli0shin)! - Start the configured Review Queue in Herdr and cleanly stop terminal input and rendering on exit.

- [#19](https://github.com/eli0shin/code-review-tui/pull/19) [`6eca755`](https://github.com/eli0shin/code-review-tui/commit/6eca75565ea2d3dbdab3f23a63e53934998a6b5c) Thanks [@eli0shin](https://github.com/eli0shin)! - Open Lumen and Review Commands in Herdr tabs through the installed `herdr` CLI.

- [#16](https://github.com/eli0shin/code-review-tui/pull/16) [`a1ec1fe`](https://github.com/eli0shin/code-review-tui/commit/a1ec1fee6062c27975c8059928a9ed23ed978d82) Thanks [@eli0shin](https://github.com/eli0shin)! - Load Review Queue data directly in the OpenTUI page when it opens, when the user refreshes, and every 60 seconds while the page is open.

- [#20](https://github.com/eli0shin/code-review-tui/pull/20) [`cbad765`](https://github.com/eli0shin/code-review-tui/commit/cbad76507c3917b44247b6f80dde355062d1ce5b) Thanks [@eli0shin](https://github.com/eli0shin)! - Open Lumen and the configured Review Command for the pull request under the Cursor, and show immediate Herdr CLI failures in the Review Queue.

- [#18](https://github.com/eli0shin/code-review-tui/pull/18) [`7696ca2`](https://github.com/eli0shin/code-review-tui/commit/7696ca2d3c61850a210bc64feab2cd5c78a684cd) Thanks [@eli0shin](https://github.com/eli0shin)! - Add page-owned Review Submission composition, validation, safe discard, submission locking, failure display, and post-success Review Queue refresh.

- [#13](https://github.com/eli0shin/code-review-tui/pull/13) [`36fa1f1`](https://github.com/eli0shin/code-review-tui/commit/36fa1f1e29d1120fd8d28a0c421635250a69e180) Thanks [@eli0shin](https://github.com/eli0shin)! - Add the GitHub CLI adapter for Review Queue data, pull request details, and Review Submissions.

- [#12](https://github.com/eli0shin/code-review-tui/pull/12) [`e5504de`](https://github.com/eli0shin/code-review-tui/commit/e5504de5b1758ef452fe8002fab5c64b532036fc) Thanks [@eli0shin](https://github.com/eli0shin)! - Add strict XDG Review configuration loading, search tokenization, effective key bindings, and tolerant updater-only settings.

- [#21](https://github.com/eli0shin/code-review-tui/pull/21) [`2c6264e`](https://github.com/eli0shin/code-review-tui/commit/2c6264e123bea720f2417e749124062ac85e3644) Thanks [@eli0shin](https://github.com/eli0shin)! - Present the Review Queue, pull request details, effective key help, and Review Submission in the accepted OpenTUI layout.

## 0.1.0

### Minor Changes

- [#5](https://github.com/eli0shin/code-review-tui/pull/5) [`2ad010a`](https://github.com/eli0shin/code-review-tui/commit/2ad010a483bf419054a938cdf471a5de4026f2df) Thanks [@eli0shin](https://github.com/eli0shin)! - Bootstrap the native `review` executable and minimal OpenTUI React application shell.
