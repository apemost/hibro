# Hibro skills

A skill gives Hibro instructions for a website. Hibro follows the open [Agent Skills](https://agentskills.io) format and adds a `match` field for page URLs.

Each skill is one `SKILL.md` file:

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

The frontmatter contains:

- `name`: a short skill name.
- `description`: what the skill helps the assistant do.
- `match`: one or more URL patterns. `*` matches any sequence of characters.

The Markdown body contains the instructions sent to the model on matching pages. Keep it focused on facts and steps the model cannot reliably discover from the page.

## Built-in and user skills

Built-in skills live in `skills/<name>/SKILL.md` and are bundled with the extension. Users can disable them in Settings but cannot edit their content.

User skills are created and managed in Settings. They use the same fields and stay in extension storage.

Hibro activates every enabled skill whose URL pattern matches the active page. The matching instructions are included in the request to the selected AI provider. Skills do not run code by themselves.

## Add a built-in skill

Create `skills/<name>/SKILL.md`. Keep all required guidance in that file because supporting folders and reference files are not bundled.

Run `pnpm typecheck`, `pnpm build`, and `pnpm test:e2e` before submitting the new skill.
