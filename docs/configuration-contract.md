# Configuration and Review Command contract

## Decision

`review` reads one user configuration file at `$XDG_CONFIG_HOME/review/config.json`. If `XDG_CONFIG_HOME` is unset, empty, or not an absolute path, it uses `$HOME/.config/review/config.json`. It does not merge files from `XDG_CONFIG_DIRS`.

The TUI requires a readable, valid file with `github.search` and `reviewCommand`. When the file does not exist, TUI startup silently creates the parent directories and the complete example below, then continues with that configuration. File creation uses exclusive create semantics so that it cannot overwrite a file created concurrently. Commands that do not start the TUI, such as `review update`, do not create the file and can use their updater defaults without it. An existing empty, malformed, unreadable, or invalid file must stop TUI startup and identify the file, field, and problem. The application does not replace or repair an existing file.

This path follows the XDG rule that `XDG_CONFIG_HOME` is the user-specific configuration base, defaults to `$HOME/.config`, and must be absolute.[^xdg]

## File schema

The normative machine-readable schema is [`config.schema.json`](./config.schema.json). JSON comments and trailing commas are not valid. Unknown fields are errors so that misspelled settings do not appear to work.

A complete example is:

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

`github.search` and `reviewCommand` are required nonblank strings. `keyBindings` and `config` are optional. The `config` object retains the updater settings supplied by the application shell.

Each omitted key-binding action gets the value shown in the example. A present action replaces its complete default list; lists do not merge. Each list must contain at least one binding.

## GitHub search tokenization

`github.search` is query data, not a shell command and not a place for additional `gh` options. Tokenize it and place the resulting arguments after `--` in the `gh search prs` invocation defined by the [GitHub CLI integration contract](./research/github-cli-integration-contract.md).

The tokenizer has three states: unquoted, single-quoted, and double-quoted.

1. Outside quotes, space, tab, carriage return, and line feed end the current argument. Repeated separators do not create empty arguments.
2. A single quote starts or ends single-quoted text. Every character inside it is literal except the closing single quote.
3. A double quote starts or ends double-quoted text. Every character inside it is literal except the closing double quote and backslash.
4. Outside single quotes, backslash removes the special meaning of the next character and adds that character literally.
5. Quoted and unquoted segments with no separator between them form one argument. An empty quoted segment creates an empty argument.
6. An unclosed quote or final backslash is an error. A query that produces no arguments or no nonempty argument is an error. Thus, `""`, `''`, and combinations of only empty quoted arguments are invalid.
7. The tokenizer does not expand environment variables, commands, tildes, globs, redirections, or operators. Characters such as `$`, `*`, `>`, `|`, `(`, and `)` are ordinary query characters.

Examples:

| Configured value                  | Resulting arguments                  |
| --------------------------------- | ------------------------------------ |
| `review-requested:@me state:open` | `review-requested:@me`, `state:open` |
| `label:"needs review" -label:wip` | `label:needs review`, `-label:wip`   |
| `'fix login' in:title`            | `fix login`, `in:title`              |
| `author:octo\ cat`                | `author:octo cat`                    |

These rules preserve intentionally grouped GitHub search terms without evaluating the query as shell text.

## Key bindings

The configurable bindings apply to the Review Queue and its pull request details modal. The modal owns all input while it is open and uses the navigation actions listed below. Its one scrolling document renders GitHub-authored bodies with OpenTUI Markdown and keeps metadata and inline code context as ordinary text. A Review Command, Lumen, and the Review Submission editor own their input while active; Review Queue bindings must not intercept that input.

A descriptor is one of:

- one printable ASCII character from `!` through `~`, such as `j`, `?`, or `A`;
- one named key: `up`, `down`, `left`, `right`, `enter`, `escape`, `tab`, `backspace`, `delete`, `home`, `end`, `pageup`, `pagedown`, or `space`;
- a lowercase letter, digit, or named key prefixed by one or more modifiers in canonical `ctrl+alt+shift+` order, such as `ctrl+r`, `alt+enter`, or `ctrl+shift+p`.

Modifier names and named keys are lowercase. Aliases such as `esc`, `return`, `cmd`, and `option` are invalid. Bindings that represent the same terminal key event, including aliases such as `A` and `shift+a`, collide. A descriptor cannot occur twice in one action or resolve to the same event as a descriptor assigned to another queue action. Startup must report both conflicting action names.

The actions have these meanings:

| Action                    | Default          | Effect                                                                    |
| ------------------------- | ---------------- | ------------------------------------------------------------------------- |
| `selectPrevious`          | `k`, `up`        | Move the Cursor to the previous Review Queue row.                         |
| `selectNext`              | `j`, `down`      | Move the Cursor to the next Review Queue row.                             |
| `openDetails`             | `enter`          | Open full-screen details for the pull request under the Cursor.           |
| `openDiff`                | `d`              | Open the pull request under the Cursor in fixed `lumen diff`.             |
| `runReviewCommand`        | `c`              | Start the Review Command for the pull request under the Cursor.           |
| `composeReviewSubmission` | `s`              | Open Review Submission composition for the pull request under the Cursor. |
| `refresh`                 | `r`              | Refresh the active Review Queue or details modal.                         |
| `pagePrevious`            | `ctrl+u`         | Scroll details up by half of the current visible viewport.                |
| `pageNext`                | `ctrl+d`         | Scroll details down by half of the current visible viewport.              |
| `scrollStart`             | `g`, `home`      | Scroll details to the start.                                              |
| `scrollEnd`               | `shift+g`, `end` | Scroll details to the end.                                                |
| `showErrors`              | `e`              | Show complete diagnostics for failed detail sources.                      |
| `showHelp`                | `?`              | Show the queue help, including effective bindings.                        |
| `quit`                    | `q`, `escape`    | Close details, or exit from the Review Queue.                             |

Details page movement uses half of the current visible scroll viewport, rounds odd viewport heights down, and moves at least one rendered line when scrolling is possible. Movement in both directions uses the same distance and clamps at the start and end.

## Opaque Review Command

`reviewCommand` is one POSIX shell command string. It includes the program, flags, pipelines or redirections, and initial input that the user wants. The application must not tokenize, rewrite, template-expand, concatenate selected values into, or evaluate part of this string separately.

The execution boundary passes the exact configured string as the single command operand to `/bin/sh -c`. It inherits the user's environment and adds the pull request under the Cursor as these environment variables:

| Variable               | Source Review Queue field  | Value                              |
| ---------------------- | -------------------------- | ---------------------------------- |
| `REVIEW_PR_URL`        | `url`                      | Canonical pull request URL.        |
| `REVIEW_PR_REPOSITORY` | `repository.nameWithOwner` | `OWNER/REPOSITORY`.                |
| `REVIEW_PR_NUMBER`     | `number`                   | Base-10 number.                    |
| `REVIEW_PR_TITLE`      | `title`                    | Title unchanged.                   |
| `REVIEW_PR_AUTHOR`     | `author.login`             | Login unchanged.                   |
| `REVIEW_PR_IS_DRAFT`   | `isDraft`                  | Lowercase `true` or `false`.       |
| `REVIEW_PR_STATE`      | `state`                    | GitHub CLI state string unchanged. |
| `REVIEW_PR_CREATED_AT` | `createdAt`                | GitHub CLI timestamp unchanged.    |
| `REVIEW_PR_UPDATED_AT` | `updatedAt`                | GitHub CLI timestamp unchanged.    |

The variables replace inherited variables with the same names for this child only. They are not set in the parent process.

The shell, rather than `review`, expands a reference such as `"$REVIEW_PR_URL"`. Thus existing quotes, substitutions, pipelines, redirects, and control operators keep their POSIX shell meaning. Pull request text stays data in the environment and cannot add shell syntax before parsing. Users must quote variable references when they want one argument; an unquoted reference intentionally gets the shell's normal field-splitting and pathname-expansion behavior.

For example:

```json
{
  "github": { "search": "review-requested:@me state:open" },
  "reviewCommand": "pi \"Review $REVIEW_PR_REPOSITORY#$REVIEW_PR_NUMBER ($REVIEW_PR_TITLE): $REVIEW_PR_URL\""
}
```

There is no `{{url}}` or similar template syntax. Text that looks like a template remains literal. This avoids the impossible task of inserting untrusted text safely into every shell quotation context while also preserving an opaque command's semantics.

[^xdg]: [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir/latest/).
