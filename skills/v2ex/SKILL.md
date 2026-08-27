---
name: V2EX
description: Read and navigate V2EX topics, nodes, and replies
match:
  - https://v2ex.com/*
  - https://*.v2ex.com/*
---

# V2EX

V2EX (`v2ex.com`) is a Chinese-language community for developers and technology
workers. Topics live in "nodes". Pages are server-rendered HTML and content is
mostly Simplified Chinese, so answer in Chinese unless the user writes
otherwise. Reading topics, nodes, and members is public; posting, replying, and
thanking require login.

## URLs

- Home tabs: `https://www.v2ex.com/?tab=<tab>` with `<tab>` one of `tech`,
  `creative`, `play`, `jobs`, `deals`, `hot`, `apple`, `city`, `qna`, `all`.
- Newest across the site: `https://www.v2ex.com/recent`.
- Topic (thread): `https://www.v2ex.com/t/<id>`.
- Node: `https://www.v2ex.com/go/<name>` (for example `/go/programmer`,
  `/go/jobs`, `/go/qna`, `/go/share`, `/go/apple`, `/go/python`). Node pages and
  `/recent` paginate with `?p=2`, `?p=3`.
- Member: `https://www.v2ex.com/member/<username>`.
- The page chrome lives in `#Top`, `#Main`, and `#Rightbar`; scope reads to
  `#Main` to skip the sidebar.

## Layout (stable landmarks)

- A topic or feed listing shows each topic in a `cell` row: the title in
  `item_title` linking to `/t/<id>`, the node tag `item_node` linking to
  `/go/<name>`, the author and time in `topic_info`, and the reply count in
  `count_livid`.
- A topic page has the title in `h1`, the original poster's body in
  `topic_content`, and the topic votes as `#topic_<id>_votes`.
- Replies are `cell` rows. Each has the floor number `no` (1, 2, and onward), the
  body `reply_content`, the time `ago`, the author link `/member/<username>`, and
  the anchor `#r_<reply_id>`.

## Working on V2EX

- Browse by subject through a node (`/go/<name>`) or by time through `/recent`;
  page with `?p=N`. The `#search` box returns live results in `#search-result`
  but has no clean URL, so node and tab URLs are the reliable way to navigate.
- For a topic, read the `topic_content` body and the `reply_content` rows; the
  floor `no` and `ago` give order and time.
- Point at a single reply with `#r_<reply_id>`, not a floor number.
- Posting, replying, and thanking are behind login; reading tasks stay public.
