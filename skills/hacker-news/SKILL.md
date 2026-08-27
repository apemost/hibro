---
name: Hacker News
description: Read and navigate Hacker News threads and comments
match:
  - https://news.ycombinator.com/*
---

# Hacker News

Hacker News (Y Combinator). The site is plain server-rendered HTML and rarely
changes, so the class names below are stable landmarks, not guesses.

## URLs

- Item (story or comment thread): `https://news.ycombinator.com/item?id=<id>`.
- User: `https://news.ycombinator.com/user?id=<username>`.
- Feeds: `/` (front page), `/newest`, `/ask` (Ask HN), `/show` (Show HN),
  `/shownew`, `/jobs`, `/best`, `/active`. Feeds paginate with `?p=2`, `?p=3`.
- There is no on-site search. Use Algolia's index:
  `https://hn.algolia.com/?q=<terms>` (append `&sort=byDate` for newest).

## Layout (stable landmarks)

- A feed lists stories as rows `tr.athing`. Each row has the rank `span.rank`,
  the title link inside `span.titleline`, the domain in `span.sitestr`, and a
  `td.subtext` with the score `span.score`, the author `a.hnuser`, the age link
  `span.age`, and the comments link.
- An item page has the story title at the top. Ask HN and Show HN posts carry
  their text in the post itself, so the body is on the item page, not on a
  linked external site.
- Comments are rows `tr.comtr` (id = the comment id). The comment body is
  `span.commtext`; the header `span.comhead` has the author, the age, and a
  parent link. Replies are indented under their parent, so indentation shows
  depth.

## Working on Hacker News

- Open a thread by `item?id=<id>`. Read comment bodies from `span.commtext` and
  context from `span.comhead`; go deeper into a subthread only when the user
  asks about a specific reply.
- For a feed, pick `/newest`, `/ask`, `/show`, or `/best` by intent and page with
  `?p=N`.
- Voting and replying require login, so reading tasks operate on what is public.
- When the user wants to find past stories or comments, go to hn.algolia.com
  rather than looking for a search box on the site.
