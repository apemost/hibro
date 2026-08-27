---
name: Wikipedia
description: Read and navigate Wikipedia articles (sections, citations, languages)
match:
  - https://*.wikipedia.org/*
  - https://wikipedia.org/*
---

# Wikipedia

Wikipedia (MediaWiki) article layout and stable landmarks. Reading is fully
public; editing needs login, which reading tasks never require.

## URLs

- Article: `https://<lang>.wikipedia.org/wiki/<Title>` with underscores for
  spaces (for example `en.wikipedia.org/wiki/Quantum_mechanics`). `<lang>` is the
  language code. `www.wikipedia.org` is only the portal.
- Section: append `#<Section_id>` to scroll to a heading. The id matches the
  heading text with spaces turned into underscores and punctuation removed.
- Search: `https://<lang>.wikipedia.org/w/index.php?search=<terms>`, or the
  search box `#searchInput`.

## Layout (stable MediaWiki landmarks)

- Title: `#firstHeading`.
- Article body: `#mw-content-text`. Scope reads to this element to drop the
  surrounding chrome (sidebar, sitenotice, edit links).
- Lead: the first paragraphs inside `#mw-content-text`, before the first section
  heading, carry the definition and the key facts.
- Summary box: `table.infobox`, usually top right.
- Contents: the table of contents near the top links to each section anchor.
- References: the numbered list `ol.references` under the References heading.
  Inline `[n]` markers link to a reference and back to the text.
- Cross-language links to the same topic are in the sidebar ("Languages").

## Working on Wikipedia

- Navigate straight to an article or section by URL instead of searching and
  clicking. It is the cheapest reliable step.
- For a summary, read the lead paragraphs plus the `table.infobox`, scoped to
  `#mw-content-text`.
- Follow a citation only when the user asks for the source; the References list
  holds the links.
- To read the same topic in another language, use the sidebar language list
  instead of searching again.
- Hatnotes at the top ("Not to be confused with", disambiguation pages) point to
  similarly named articles and resolve ambiguity.
