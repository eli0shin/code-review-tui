# Code Review TUI

A personal terminal interface for reviewing GitHub pull requests.

The current application shell opens an OpenTUI React view for the **Review Queue**. GitHub search, Lumen, the Review Command, and Review Submission behavior will be added in later changes.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/eli0shin/code-review-tui/main/install.sh | bash
```

The installer supports x64 and arm64 Linux and macOS systems. It installs the `review` executable to `~/.local/bin`.

Use `review update` to install the latest native release. The executable also checks for stable updates in a detached worker. Update settings use `$XDG_CONFIG_HOME/review/config.json` or `~/.config/review/config.json`:

```json
{
  "config": {
    "updateBehavior": "notify",
    "updateCheckIntervalHours": 12
  }
}
```

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
