# Hibro skills

A skill gives Hibro instructions for a website, such as how to find an article or which details to include in a summary. Enabled skills apply when the page address matches their rules. Their instructions are sent to your selected AI provider.

## Use built-in skills

Open Agent skills in Settings. Use the checkbox beside a skill to turn it on or off.

Open its ellipsis menu and choose View to read or copy the instructions and website rules. Built-in skills cannot be edited, but you can copy their content into a skill of your own. You can still view a skill when it is disabled.

## Create your own skill

1. In Agent skills, choose New skill.
2. Enter a name and, optionally, a short description.
3. Add the website rules under URL patterns, one per line.
4. Write the instructions and save.

New skills start enabled. Editing a skill keeps its current on/off setting.

For example, use `https://example.com/*` for the website rule and "Summarize each article in five bullet points and include its source links" for the instructions.

Your skills appear under My skills. Use the checkbox to turn one on or off, or its ellipsis menu to Edit or Delete it. Changes also appear in other open Settings pages. Skills stay in your browser and are not synced to other devices by Hibro.

## Website rules

A URL pattern tells Hibro where a skill applies. `*` stands for any number of characters:

- `https://example.com/*` matches addresses on `example.com`.
- `https://*.example.com/*` matches its subdomains. Add both rules if you need both.

Matching uses the full address and is case-sensitive. A skill with no matching rule stays inactive. If several enabled skills match, Hibro uses all of them.

Skills provide instructions; they do not run scripts or give Hibro extra permissions. To contribute a built-in skill, see the repository's [Agent Skills guide](https://github.com/apemost/hibro/blob/main/skills/README.md).
