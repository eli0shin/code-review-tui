# Code Review TUI

A personal terminal interface for reviewing GitHub pull requests.

Run `review` inside a Herdr pane. The application loads the configured GitHub pull request search into the **Review Queue**. From the queue, you can inspect pull request details, open Lumen, run a Review Command, and submit a review.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/eli0shin/code-review-tui/main/install.sh | bash
```

The installer supports x64 and arm64 glibc Linux and macOS systems. It rejects musl Linux because the published Linux executables require glibc. It installs the `review` executable to `~/.local/bin`.

Create `$XDG_CONFIG_HOME/review/config.json` or `~/.config/review/config.json`:

```json
{
  "github": {
    "search": "review-requested:@me state:open"
  },
  "reviewCommand": "pi --prompt 'Review $REVIEW_PR_URL'",
  "config": {
    "updateBehavior": "notify",
    "updateCheckIntervalHours": 12
  }
}
```

Use `review update` to install the latest native release. The executable also checks for stable updates in a detached worker.

`updateBehavior` can be `auto`, `notify`, or `off`. Update state uses `$XDG_STATE_HOME/review-update-state` or `~/.review-update-state`.

## Development

```bash
bun install
bun run dev
bun run build
bun run format
bun run lint
bun run typecheck
bun run test
```
