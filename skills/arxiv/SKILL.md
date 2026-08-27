---
name: arxiv
description: Read and navigate arXiv papers (abstracts, PDF, search)
match:
  - https://arxiv.org/*
  - https://*.arxiv.org/*
---

# arXiv

arXiv paper layout and reliable URL patterns.

## URLs

- Abstract page: `https://arxiv.org/abs/<id>` (e.g. `2401.12345`). Holds the
  title, authors, full abstract, subjects, DOI, and a link to the PDF.
- PDF page: `https://arxiv.org/pdf/<id>` (the full paper text).
- Search: `https://arxiv.org/search/?searchtype=all&query=<terms>`.

## Working on arXiv

- Prefer the abstract page over the PDF. The abstract page is plain HTML and
  reliable to read; the PDF is large and not worth extracting in full.
- On the abstract page the title, authors, and abstract are the main heading,
  the "Authors:" line, and the "Abstract:" block. Take a fresh snapshot and
  resolve elements by their ids rather than guessing selectors.
- To open a paper by id, go to `/abs/<id>`; for its PDF, `/pdf/<id>`.
- Search results list each paper with its id, title, and authors; the title
  links to the abstract page.
- Do not try to download or parse the full PDF. Summarize or answer from the
  abstract page instead.
