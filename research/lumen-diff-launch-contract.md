# `lumen diff` launch contract

Research target: Lumen `v2.31.0` (`d7811336c911501175c2e4d9a449c0fe985ae893`). The behavior below is version-specific.

## Conclusion

`lumen diff` can review a pull request from a different repository without a checkout of that **target** repository. However, `v2.31.0` cannot start from an arbitrary directory. It initializes a VCS backend before it handles the `diff` command, so its current working directory must be inside any Git or Jujutsu repository. That local repository can be unrelated to the pull request.

For the Lumen invocation, pass the full pull request URL and run Lumen as a foreground child in the user's terminal:

```sh
lumen diff https://github.com/OWNER/REPO/pull/NUMBER
```

Before launch, suspend the parent TUI. Wait for Lumen to exit. After every exit, restore the parent's terminal modes and repaint the parent TUI.

## Pull request identification

Lumen accepts the pull request as a positional reference or through `--pr`. It treats an HTTP(S) URL as a pull request when it can extract the owner, repository, and numeric segment after `pull`. A numeric reference has no repository identity by itself.[^pr-parser]

Repository selection has this precedence:

1. A full pull request URL supplies `owner/repo`. It takes precedence over `--origin`.
2. A number with `--origin OWNER/REPO` uses that explicit repository.
3. A number without `--origin` uses the current Git repository's `origin` remote.

The implementation shows this precedence directly.[^repo-precedence] The command help also defines `--origin` as `owner/repo`, with the `origin` Git remote as its default.[^cli-options]

`--detect-pr` is different. It runs `gh pr view` with no pull request or repository argument and reads the pull request number for the current branch.[^detect-pr] Thus, this mode requires the current checkout and branch to identify the pull request. It is not the cross-repository launch mode.

**Recommended contract:** use the full URL already present in each Review Queue item. Do not use a bare number or `--detect-pr`.

## How remote content is opened without a target checkout

After parsing the identity, Lumen uses authenticated GitHub CLI calls:

1. It sends a GraphQL request to get the pull request node ID, base and head branch names, and base and head repository owners.[^metadata]
2. It runs `gh pr diff NUMBER --repo OWNER/REPO` to get the changed-file list.[^pr-diff]
3. It requests each old and new file through `gh api repos/OWNER/REPO/contents/PATH?ref=REF`, including separate base and fork owners when necessary.[^file-content]

GitHub CLI documents that `gh pr diff --repo [HOST/]OWNER/REPO` selects another repository.[^gh-pr-diff] It also documents `gh api` as an authenticated API request.[^gh-api]

Lumen does not clone or fetch the target repository in this path. The machine must have `gh` installed and authenticated with access to the target pull request.

## Current working directory requirement

At process startup, Lumen gets the current directory and creates a VCS backend before command dispatch, including before `Diff` dispatch.[^startup] Auto-detection walks upward until it finds `.jj` or `.git`; if it finds neither, backend creation returns `not a repository`.[^vcs-detection]

Therefore:

- A directory in an unrelated Git or Jujutsu checkout is sufficient when the Lumen invocation includes a full pull request URL.
- A directory outside all repositories is not sufficient, even with a full URL or `--origin`.
- A bare pull request number additionally needs either `--origin OWNER/REPO` or a Git `origin` that identifies the target.
- `--detect-pr` needs the target branch checkout context.

Observed with the installed `lumen 2.31.0`:

| Working directory             | Input                                       | Result                                                    |
| ----------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| `/tmp` outside a repository   | full URL                                    | exits 1: `not a repository`                               |
| `/tmp` outside a repository   | number plus `--origin`                      | exits 1: `not a repository`                               |
| this unrelated Git repository | `https://github.com/jnsahaj/lumen/pull/172` | fetches metadata and all file content, then opens the TUI |

**Integration implication:** the parent application must set the child working directory to a known local Git or Jujutsu checkout. A stable application repository is enough; it does not need one checkout per Review Queue item. This is a Lumen limitation, not a GitHub API requirement.

## Terminal ownership and return of control

Lumen is a synchronous full-screen process. On entry it enables raw mode, opens the alternate screen, enables mouse capture, and optionally enables the Kitty keyboard protocol.[^terminal-entry] If stdout is redirected, it tries to draw through `/dev/tty` so stdout remains available for exported annotations.[^tty-writer]

With no active selection or search, `q`, Escape, and Ctrl-C break the main event loop.[^exit-keys] On this normal path, Lumen pops the keyboard protocol, disables mouse capture, leaves the alternate screen, disables raw mode, and returns from the process.[^terminal-exit] The `s` workflow can also exit and write an annotation payload to stdout after terminal cleanup.[^annotation-output]

A pseudo-terminal check against `v2.31.0` confirmed that `q`:

- returned exit status 0;
- emitted both enter- and leave-alternate-screen sequences;
- emitted both mouse enable and disable sequences; and
- restored canonical input and echo settings.

The parent terminal application should:

1. stop its render and input loops;
2. restore cooked mode and leave its own alternate screen if its framework requires this;
3. spawn Lumen in the foreground with the same controlling terminal;
4. wait for the child process instead of reading terminal input concurrently;
5. on every child exit status, restore the parent's terminal settings, re-enter its screen, and redraw.

Do not depend only on Lumen's cleanup. The setup and event loop use fallible operations before the explicit cleanup block, and there is no terminal-cleanup guard in this code path.[^terminal-entry][^terminal-exit] A forced kill or an I/O error can therefore bypass normal restoration. Parent-side restoration is the safe ownership boundary.

## Sources

[^pr-parser]: [Lumen `v2.31.0`, `src/command/diff/mod.rs`, lines 53-79](https://github.com/jnsahaj/lumen/blob/d7811336c911501175c2e4d9a449c0fe985ae893/src/command/diff/mod.rs#L53-L79)

[^repo-precedence]: [Lumen `v2.31.0`, repository selection, lines 107-130](https://github.com/jnsahaj/lumen/blob/d7811336c911501175c2e4d9a449c0fe985ae893/src/command/diff/mod.rs#L107-L130)

[^cli-options]: [Lumen `v2.31.0`, diff CLI options, lines 108-149](https://github.com/jnsahaj/lumen/blob/d7811336c911501175c2e4d9a449c0fe985ae893/src/config/cli.rs#L108-L149)

[^detect-pr]: [Lumen `v2.31.0`, branch pull request detection, lines 318-359](https://github.com/jnsahaj/lumen/blob/d7811336c911501175c2e4d9a449c0fe985ae893/src/command/diff/mod.rs#L318-L359)

[^metadata]: [Lumen `v2.31.0`, pull request GraphQL metadata, lines 132-175](https://github.com/jnsahaj/lumen/blob/d7811336c911501175c2e4d9a449c0fe985ae893/src/command/diff/mod.rs#L132-L175)

[^pr-diff]: [Lumen `v2.31.0`, changed-file retrieval, lines 170-212](https://github.com/jnsahaj/lumen/blob/d7811336c911501175c2e4d9a449c0fe985ae893/src/command/diff/git.rs#L170-L212)

[^file-content]: [Lumen `v2.31.0`, base/head selection and content API, lines 219-233 and 399-413](https://github.com/jnsahaj/lumen/blob/d7811336c911501175c2e4d9a449c0fe985ae893/src/command/diff/git.rs#L219-L233) and [lines 399-413](https://github.com/jnsahaj/lumen/blob/d7811336c911501175c2e4d9a449c0fe985ae893/src/command/diff/git.rs#L399-L413)

[^gh-pr-diff]: [Official GitHub CLI manual: `gh pr diff`](https://cli.github.com/manual/gh_pr_diff)

[^gh-api]: [Official GitHub CLI manual: `gh api`](https://cli.github.com/manual/gh_api)

[^startup]: [Lumen `v2.31.0`, backend initialization before dispatch, lines 29-45 and diff dispatch at lines 125-150](https://github.com/jnsahaj/lumen/blob/d7811336c911501175c2e4d9a449c0fe985ae893/src/main.rs#L29-L45)

[^vcs-detection]: [Lumen `v2.31.0`, upward VCS detection](https://github.com/jnsahaj/lumen/blob/d7811336c911501175c2e4d9a449c0fe985ae893/src/vcs/detection.rs#L14-L37) and [`not a repository` result](https://github.com/jnsahaj/lumen/blob/d7811336c911501175c2e4d9a449c0fe985ae893/src/vcs/mod.rs#L39-L70)

[^terminal-entry]: [Lumen `v2.31.0`, terminal setup, lines 344-358](https://github.com/jnsahaj/lumen/blob/d7811336c911501175c2e4d9a449c0fe985ae893/src/command/diff/app.rs#L344-L358)

[^tty-writer]: [Lumen `v2.31.0`, stdout and `/dev/tty` writer selection, lines 17-36](https://github.com/jnsahaj/lumen/blob/d7811336c911501175c2e4d9a449c0fe985ae893/src/command/diff/app.rs#L17-L36)

[^exit-keys]: [Lumen `v2.31.0`, main-loop exit keys, lines 1241-1266](https://github.com/jnsahaj/lumen/blob/d7811336c911501175c2e4d9a449c0fe985ae893/src/command/diff/app.rs#L1241-L1266)

[^terminal-exit]: [Lumen `v2.31.0`, normal terminal cleanup, lines 2204-2210](https://github.com/jnsahaj/lumen/blob/d7811336c911501175c2e4d9a449c0fe985ae893/src/command/diff/app.rs#L2204-L2210)

[^annotation-output]: [Lumen `v2.31.0`, annotation output after cleanup, lines 2212-2218](https://github.com/jnsahaj/lumen/blob/d7811336c911501175c2e4d9a449c0fe985ae893/src/command/diff/app.rs#L2212-L2218)
