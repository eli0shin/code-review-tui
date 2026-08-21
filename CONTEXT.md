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

**Review Queue Tab**:
The Herdr tab that contains the Review Queue and receives focus when a launched review tool exits.
_Avoid_: Parent tab, caller tab

**Tool Tab**:
A Herdr tab that runs one Lumen or Review Command process for a selected pull request.
_Avoid_: Cab, embedded terminal
