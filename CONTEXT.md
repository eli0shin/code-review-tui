# Code Review

## Language

**Review Queue**:
The current GitHub search result containing pull requests that need the user's review.
_Avoid_: Workflow queue, task list

**Review Command**:
The user-configured shell command that starts an interactive agent review for a selected pull request. The command includes the program, flags, and initial input.
_Avoid_: Review Prompt, Pi command

**Review Submission**:
A GitHub pull request review with a message and one decision: comment, approve, or request changes.
_Avoid_: Inline comment
