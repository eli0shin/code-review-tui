---
Assigned-To:
Tags:
  - bug
Parent:
Blocked-By: []
---

## Goal

Make the first `review` startup immediately usable when the Review configuration file does not exist.

## Required behavior

When a command would otherwise fail only because its Review configuration file does not exist:

1. Create the parent directories with normal filesystem defaults.
2. Create a formatted `config.json` with this complete configuration:

```json
{
  "github": {
    "search": "is:pr review-requested:@me state:open"
  },
  "reviewCommand": "pi --prompt \"review the changes in this pr and report your findings to me: $REVIEW_PR_URL\"",
  "keyBindings": {
    "selectPrevious": ["k", "up"],
    "selectNext": ["j", "down"],
    "openDiff": ["d", "enter"],
    "runReviewCommand": ["c"],
    "composeReviewSubmission": ["s"],
    "refresh": ["r"],
    "showHelp": ["?"],
    "quit": ["q"]
  },
  "config": {
    "updateBehavior": "auto",
    "updateCheckIntervalHours": 24
  }
}
```

3. Continue normal startup using the new configuration.
4. Do not print or display any notice about creating the file.

Do not create the file for commands that already work without it. Do not replace or repair an existing empty, malformed, unreadable, or invalid file. Preserve strict validation for existing files. Do not explicitly set ownership or permissions. Do not overwrite a file that appears concurrently.

## Done when

- Missing configuration gets the complete editable defaults and the Review Queue starts normally.
- Successful initialization is silent.
- Existing invalid configuration still fails with its actionable diagnostic.
- Concurrent creation cannot overwrite another file.
- Automated tests cover creation, continuation, silence, existing invalid files, and commands that do not require configuration.
- User documentation describes the generated defaults.
- A patch changeset records the fix.
