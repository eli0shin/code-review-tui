# Code Review

## Language

**Review Queue**:
The current GitHub search result containing pull requests that need the user's review.
_Avoid_: Workflow queue, task list

**Cursor**:
The position in the Review Queue that highlights one visible pull request row. The cursor has no pull request identity.
_Avoid_: Selection, selected pull request

**Review Command**:
The user-configured shell command that starts an interactive agent review for the pull request under the cursor. The command includes the program, flags, and initial input.
_Avoid_: Review Prompt, Pi command

**Review Submission**:
A GitHub pull request review with a message and one decision: comment, approve, or request changes.
_Avoid_: Inline comment

**GitHub-authored body**:
A pull request description, issue comment body, submitted review body, or inline review comment body. The Pull Request Details modal renders it as Markdown. Metadata and inline code context are not GitHub-authored bodies.
_Avoid_: Plain-text body

**Review Queue Tab**:
The saved Herdr tab that contains the Review Queue. `review` makes a best-effort attempt to focus its Review Queue pane when a launched tool exits.
_Avoid_: Parent tab, caller tab

**Herdr tab**:
A tab created by Herdr to run Lumen or a Review Command for the pull request under the Cursor.
_Avoid_: Tool Tab, Cab, embedded terminal
