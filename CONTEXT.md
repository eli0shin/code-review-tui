# Code Review

## Language

**Review Queue**:
The current GitHub search result containing pull requests that need the user's review.
_Avoid_: Workflow queue, task list

**Cursor**:
The position in the Review Queue that highlights one visible pull request row. The cursor has no pull request identity.
_Avoid_: Selection, selected pull request

**Stack**:
A GitHub native stack of pull requests in one repository, where each layer targets the branch of the layer below it. Layer 1 is the bottom layer. A Review Queue row labels its layer as `stack 3/4`, and the layers that match the search are listed together, highest layer first.
_Avoid_: Stacked PR chain, dependency chain

**Review Command**:
The user-configured shell command that starts an interactive agent review for the pull request under the cursor. The command includes the program, flags, and initial input.
_Avoid_: Review Prompt, Pi command

**Diff Command**:
The optional user-configured shell command that opens the diff for the pull request under the cursor. It replaces the default Lumen diff.
_Avoid_: Diff viewer, Lumen command

**Review Submission**:
A GitHub pull request review with a message and one decision: comment, approve, or request changes.
_Avoid_: Inline comment

**GitHub-authored body**:
A pull request description, issue comment body, submitted review body, or inline review comment body. The Pull Request Details modal renders it as Markdown. Metadata and inline code context are not GitHub-authored bodies.
_Avoid_: Plain-text body

**Review thread**:
The inline review comments on one location in the diff: the comment that starts it and its replies. The Pull Request Details conversation shows each review thread as one entry at the time of its first comment, with its location, resolved state, and source context shown once. Resolved review threads are dimmed. A comment-only submitted review with no body is not shown, because its review threads already show its comments.
_Avoid_: Inline comment chain, reply chain

**Review Queue Tab**:
The saved Herdr tab that contains the Review Queue. `review` makes a best-effort attempt to focus its Review Queue pane when a launched tool exits.
_Avoid_: Parent tab, caller tab

**Herdr tab**:
A tab created by Herdr to run Lumen, a Diff Command, or a Review Command for the pull request under the Cursor.
_Avoid_: Tool Tab, Cab, embedded terminal

**Check**:
A CI check on a pull request, identified by its workflow and name. GitHub reports every run of a check, including reruns and repeated workflow triggers; the Pull Request Details modal and the Review Queue show only the latest run of each check.
_Avoid_: Status, job
