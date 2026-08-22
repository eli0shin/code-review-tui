# code-review-tui

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
