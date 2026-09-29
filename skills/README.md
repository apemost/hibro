# Bundled Agent Skills

This guide covers files bundled with the extension. To create a personal skill in Settings, see [Hibro skills](../docs/skills.md).

## File format

Built-in skills live in `skills/<name>/SKILL.md` and are bundled when the extension is built. Hibro uses a limited subset of the [Agent Skills](https://agentskills.io/specification) file structure, with an additional `match` field:

```markdown
---
name: example
description: How to operate example.com
match:
  - https://example.com/*
  - https://*.example.com/*
---

The search box is `input#q`. Submit with `button#go`.
```

The supported frontmatter fields are:

- `name`: a single-line display name.
- `description`: a single-line description of what the skill helps the assistant do.
- `match`: a single pattern or an indented list of unquoted patterns, as shown above.

The parser supports these simple fields, not general YAML features such as multiline values or inline arrays. Other metadata does not affect skill behavior. Hibro does not load companion scripts, references, or assets, and `allowed-tools` does not configure its tool permissions.

The Markdown body contains the instructions sent to the model on matching pages. Keep it focused on facts and steps the model cannot reliably discover from the page.

## Matching and contributions

Patterns are case-sensitive globs over the complete URL. `*` matches any sequence of characters; all other characters are literal. These are not browser permission match patterns.

Keep existing skill names stable when editing a file: the name is part of the identifier used for saved enable/disable preferences.

Follow [Contributing](../CONTRIBUTING.md) for changes and verification. Include a regression in `e2e/extension.spec.ts` when adding or changing matching or activation behavior.
