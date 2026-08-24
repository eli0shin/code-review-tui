---
Assigned-To: code-review-tui@040-render-pull-request-details-with-opentui-markdown
Tags:
  - ui
  - integration
Parent:
Blocked-By: []
---

## Problem

The Pull Request Details modal currently displays GitHub Markdown bodies as literal plain text. OpenTUI provides a Markdown renderer component, so the application should use that supported component instead of showing Markdown syntax to the reviewer or implementing its own parser.

This decision supersedes the earlier plain-text-body contract for the Pull Request Details modal.

## Outcome

Render GitHub-authored Markdown in the full-screen Pull Request Details modal with OpenTUI's Markdown renderer component.

## Contract

- Use the Markdown renderer supplied by the installed OpenTUI packages. Do not add a separate Markdown parser or create an application-specific Markdown rendering engine.
- Render the pull request description, issue comment bodies, submitted review bodies, and inline review comment bodies as Markdown.
- Keep metadata, requested and submitted reviewer summaries, check names and states, section headings, inline code context, resolved/outdated labels, loading markers, and failure markers as their existing non-Markdown content.
- Preserve the borderless full-screen modal, one scrolling document, configurable controls, symmetric viewport-based half-page movement, resize behavior, and independent detail-source loading and partial-failure behavior.
- Keep every surface on the terminal's normal background and foreground. Configure the OpenTUI renderer to use the existing Pull Request List semantic accents where its API permits styling; do not introduce a separate visual language.
- Keep GitHub content inert. Rendering must not execute embedded HTML, terminal escape sequences, links, or other content as application commands.
- Follow the installed OpenTUI API and component lifecycle. Update the relevant architecture, configuration, and domain-context documentation to remove the superseded plain-text rule.
- Add a patch changeset.

## Acceptance evidence

- Integration or render-level tests prove representative headings, emphasis, lists, links, block quotes, fenced code, and line wrapping are passed through and rendered by the OpenTUI Markdown component in the details modal.
- Tests prove all four GitHub-authored body locations use Markdown while metadata and inline code context remain ordinary text.
- Tests prove details scrolling and independent partial loading/failure behavior still work.
- Formatting, lint, typecheck, all tests, build, and native executable smoke coverage pass.

## Resolution

Implemented in PR #44 and squash-merged as `d02ac4b7cf6445cba8ef307d3936cc92e45717ab`.
