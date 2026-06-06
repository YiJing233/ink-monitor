---
name: Feature request
about: Suggest a new feature or improvement
title: "[feat]: "
labels: ["enhancement", "needs-triage"]
assignees: []
---

## Problem

What problem does this solve? What use case does it enable?

## Proposed solution

A clear and concise description of what you want to happen.

## Alternatives considered

What other approaches did you consider? Why is this one better?

## E-ink impact

⚠️ **Display-side changes require extra scrutiny** because the `/display` page
must keep working on Kindle experimental WebKit (no Grid, no `:has()`, no
WebSocket, no `<canvas>`, no transitions). If your feature renders on
`/display`, describe how it stays e-ink-safe.

## Willingness to contribute

- [ ] I'd like to implement this myself
- [ ] I'm open to a PR from the maintainers
- [ ] I just want to discuss before deciding

## Additional context

Mockups, examples from other tools, or links to relevant discussions.
