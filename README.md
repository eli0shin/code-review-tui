# Code Review TUI

A personal terminal interface for reviewing GitHub pull requests.

Run `review` inside a Herdr pane. The application loads the configured GitHub pull request search into the **Review Queue**. From the queue, you can inspect pull request details, open Lumen, run a Review Command, and submit a review.

## Requirements

- x64 or arm64 macOS, or glibc Linux. musl Linux is not supported.
- [GitHub CLI](https://cli.github.com/) installed and authenticated with `gh auth login`.
- [Herdr](https://herdr.dev/) and [Lumen](https://github.com/jnsahaj/lumen) installed and available on `PATH`.

Run `review` inside a Herdr pane. Start it in a Git or Jujutsu repository if you want to open Lumen.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/eli0shin/code-review-tui/main/install.sh | bash
```

The installer puts `review` in `~/.local/bin`. Add that directory to `PATH` when the installer asks you to do so.

Install the bundled user-invoked Agent Skill:

```bash
review skill install
```

This command creates or replaces `~/.agents/skills/review-comments/SKILL.md`. It does not need Review configuration or the external review tools.

## Configure

On the first `review` startup, Review creates `$XDG_CONFIG_HOME/review/config.json` with the editable defaults below. When `XDG_CONFIG_HOME` is not an absolute path, it creates `~/.config/review/config.json`. Existing files must pass strict validation and are never replaced or repaired automatically.

```json
{
  "github": {
    "search": "is:pr review-requested:@me state:open"
  },
  "reviewCommand": "pi \"review the changes in this pr and report your findings to me: $REVIEW_PR_URL\"",
  "keyBindings": {
    "selectPrevious": ["k", "up"],
    "selectNext": ["j", "down"],
    "openDetails": ["enter"],
    "openDiff": ["d"],
    "runReviewCommand": ["c"],
    "composeReviewSubmission": ["s"],
    "refresh": ["r"],
    "pagePrevious": ["ctrl+u"],
    "pageNext": ["ctrl+d"],
    "scrollStart": ["g", "home"],
    "scrollEnd": ["shift+g", "end"],
    "showErrors": ["e"],
    "showHelp": ["?"],
    "quit": ["q", "escape"]
  },
  "config": {
    "updateBehavior": "auto",
    "updateCheckIntervalHours": 24
  }
}
```

`github.search` contains GitHub pull request search terms, not extra `gh` flags. `keyBindings` and `config` are optional. An action that is present in `keyBindings` replaces that action's complete default list.

See the [configuration contract](docs/configuration-contract.md) for all accepted key descriptors and validation rules.

## Use the Review Queue

| Default key  | Action                                                |
| ------------ | ----------------------------------------------------- |
| `j`/`down`   | Move the Cursor to the next pull request.             |
| `k`/`up`     | Move the Cursor to the previous pull request.         |
| `enter`      | Open full-screen pull request details.                |
| `d`          | Open the pull request in `lumen diff` in a Herdr tab. |
| `c`          | Run the configured Review Command in a Herdr tab.     |
| `s`          | Compose a Review Submission.                          |
| `r`          | Refresh the Review Queue.                             |
| `?`          | Show the effective Review Queue keys.                 |
| `q`/`escape` | Quit.                                                 |

Pull request details include reviewers, checks, the plain-text description, and the complete review conversation. Use the configured previous/next keys to scroll by one line, `Ctrl+U`/`Ctrl+D` to move by half a page, `g`/`Home` and `Shift+G`/`End` to move to the start and end, `r` to refresh, `e` to show complete source diagnostics, and `q`/`Escape` to return to the unchanged Review Queue.

When you send comments from Lumen, Review saves Lumen's exact stdout at `/tmp/review/lumen/<org>/<repo>/<number>.txt`. A successful nonempty send replaces the prior file. Leaving Lumen without a send, or a failed Lumen run, keeps the prior file unchanged. The Review Command is a separate interaction and does not receive these comments.

Every application surface uses the terminal's normal background and foreground. Details, help, Review Submission, status, and diagnostic surfaces reuse the Review Queue accents for metadata, repositories, authors, success, failure, and warnings. Only the row under the Cursor uses the highlighted-row background.

The Review Command runs as the exact configured POSIX shell command. It receives `REVIEW_PR_URL`, `REVIEW_PR_REPOSITORY`, `REVIEW_PR_NUMBER`, `REVIEW_PR_TITLE`, `REVIEW_PR_AUTHOR`, `REVIEW_PR_IS_DRAFT`, `REVIEW_PR_STATE`, `REVIEW_PR_CREATED_AT`, and `REVIEW_PR_UPDATED_AT`. Quote variable references when one value must stay one shell argument.

A Review Submission can comment, approve, or request changes. Write the message directly in the submission modal, then press `Ctrl+C` to comment, `Ctrl+A` to approve, or `Ctrl+R` to request changes immediately. Press `Esc` to close and discard without confirmation. Comments and change requests need a nonblank message. Approvals can have an empty message. Review submits one top-level GitHub review; inline comments are not supported.

## Read Lumen Review Comments with an Agent

After you run `review skill install`, use `/skill:review-comments` in agents that expose Agent Skills as commands. The skill tells the agent where Lumen saved the comments for the pull request under review.

Run `review skill install` again to replace the installed skill with the bundled version.

## Update

Run `review update` to install the latest stable native release. The configured update behavior is:

- `auto` (default): check in a detached worker and install a newer stable release.
- `notify`: check in a detached worker and print an available-version notice on a later command.
- `off`: do not check automatically. Manual `review update` still works.

`updateCheckIntervalHours` defaults to `24`. Update state uses `$XDG_STATE_HOME/review-update-state` when `XDG_STATE_HOME` is set, or `~/.review-update-state` otherwise.

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
