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

Settings groups skills under Built-in skills and My skills. Each row shows the name and description, with its checkbox and ellipsis menu aligned with the name. URL patterns are available in the View or Edit dialog; user skills without a description show their patterns in the list as a fallback.

Built-in skills live in `skills/<name>/SKILL.md` and are bundled with the extension. In Settings, open Agent skills, open a skill's ellipsis menu, and choose View to inspect its name, description, URL patterns, and full instructions. You can select and copy the content, but cannot edit it. The checkbox on the left enables or disables the skill; disabled skills remain available to view.

User skills are created and managed in Settings. Their ellipsis menu offers Edit and Delete, and their left checkbox controls whether they are enabled. They use the same fields and stay in extension storage.

Hibro activates every enabled skill whose URL pattern matches the active page. The matching instructions are included in the request to the selected AI provider. Skills do not run code by themselves.
