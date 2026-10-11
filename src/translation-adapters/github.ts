// GitHub source comments: collection, source identity, and reversible rendering.
import { GitHubCodeLayout, type CommentSyntax } from '../github-code-layout';
import type { TranslationAdapter, TranslationSource } from './types';
import {
  TRANSLATION_NODE_ATTR,
  TRANSLATION_SKIP_SELECTOR,
  isVisibleChild,
  ownBlockText,
  buildTranslationNode,
  insertTranslation,
} from './dom';

interface CommentSource {
  el: HTMLElement;
  text: string;
  comment: CommentSyntax;
  lines: { el: HTMLElement; text: string }[];
}

function isCommentSource(el: HTMLElement): boolean {
  if (el.closest(TRANSLATION_SKIP_SELECTOR)) return false;
  // GitHub exposes the source textarea to screen readers instead of the
  // visible presentation layer. No other aria-hidden ancestor is exempt.
  if (
    el.closest(
      '[aria-hidden="true"]:not(.react-code-file-contents[role="presentation"])',
    )
  )
    return false;
  if (el.parentElement?.closest('.pl-c')) return false;
  if (el.closest(`[${TRANSLATION_NODE_ATTR}]`)) return false;
  return isVisibleChild(el);
}

// Consecutive standalone line comments form one paragraph, separated by blank
// comments or code. Block comments keep their opening and closing delimiters,
// including delimiter-only lines. Comments starting after code are excluded,
// along with their continuation lines when they span multiple source rows.
// GitHub's tokens remain the authority for what is a comment.
function githubCommentGroups(): CommentSource[] {
  const groups: CommentSource[] = [];
  let previousLine = -1;
  let previousRoot: Element | null = null;
  let ignoredBlockRoot: Element | null = null;
  for (const el of document.querySelectorAll<HTMLElement>(
    '.react-code-file-contents .react-file-line, .blob-code',
  )) {
    const comments = Array.from(
      el.querySelectorAll<HTMLElement>('.pl-c'),
    ).filter((comment) => isCommentSource(comment));
    const raw = comments.map(ownBlockText).join(' ').trim();
    if (!raw) {
      previousLine = -1;
      continue;
    }
    const suffix = /(?:\*\/|-->)$/.exec(raw)?.[0] ?? '';
    const withoutEnd = suffix ? raw.slice(0, -suffix.length).trimEnd() : raw;
    const prefix =
      /^(?:\/\/[/!]*|#+|--+|;+|%+|\/\*+|<!--|\*+)\s*/.exec(withoutEnd)?.[0] ??
      '';
    const text = withoutEnd.slice(prefix.length).trim();
    const widthEm = comments.reduce(
      (width, comment) =>
        Math.max(
          width,
          comment.getBoundingClientRect().width /
            parseFloat(getComputedStyle(comment).fontSize),
        ),
      0,
    );
    const comment = {
      prefix: prefix.trimEnd(),
      suffix,
      widthEm,
      indent: /^[\t ]*/.exec(el.textContent ?? '')?.[0] ?? '',
      singleLine: Boolean(suffix) && /^(?:\/\*|<!--)/.test(prefix),
    };
    const line = Number(el.dataset.lineNumber ?? el.id.replace(/^LC/, ''));
    const root = el.closest('.react-code-file-contents, table');
    if (root && ignoredBlockRoot === root) {
      if (suffix) ignoredBlockRoot = null;
      previousLine = -1;
      continue;
    }
    const standalone = ownBlockText(el) === raw;
    const group = groups[groups.length - 1];
    const inBlock =
      group?.comment &&
      /^(?:\/\*|<!--)/.test(group.comment.prefix) &&
      !group.comment.suffix;
    const adjacent = previousRoot === root && previousLine + 1 === line;
    if (!standalone && !(adjacent && inBlock)) {
      ignoredBlockRoot =
        /^(?:\/\*|<!--)/.test(comment.prefix) && !suffix ? root : null;
      previousLine = -1;
      continue;
    }
    if (
      adjacent &&
      (inBlock ||
        (standalone && text && group?.comment?.prefix === comment.prefix))
    ) {
      group.lines.push({ el, text: ownBlockText(el) });
      group.el = el;
      group.text = `${group.text} ${text}`.trim();
      group.comment!.suffix = suffix;
      group.comment!.widthEm = Math.max(group.comment!.widthEm, widthEm);
    } else if (text || /^(?:\/\*|<!--)/.test(comment.prefix)) {
      groups.push({
        el,
        text,
        comment,
        lines: [{ el, text: ownBlockText(el) }],
      });
    } else {
      previousLine = -1;
      continue;
    }
    previousLine =
      !suffix && (standalone || /^(?:\/\*|<!--)/.test(comment.prefix))
        ? line
        : -1;
    previousRoot = root;
  }
  return groups;
}

/** Creates a comment-only adapter, including an empty result for unknown layouts. */
export function createGitHubAdapter(): TranslationAdapter {
  let layout: GitHubCodeLayout | null = null;
  return {
    collect(): TranslationSource[] {
      return githubCommentGroups().map((group) => {
        const root = group.el.closest('.react-code-file-contents, table');
        return {
          text: group.text,
          get element() {
            return group.el;
          },
          isCurrent() {
            if (!root?.isConnected) return false;
            // Validate every source row, not just the final translation anchor.
            // GitHub can recreate matching rows after folding them.
            for (const line of group.lines) {
              const el = line.el.isConnected
                ? line.el
                : document.getElementById(line.el.id);
              if (!el || !root.contains(el) || ownBlockText(el) !== line.text)
                return false;
              line.el = el;
            }
            group.el = group.lines[group.lines.length - 1].el;
            return true;
          },
          render(text, language) {
            const node = buildTranslationNode(
              [group.comment.prefix, text, group.comment.suffix]
                .filter(Boolean)
                .join(' '),
              language,
            );
            node.classList.add('pl-c');
            insertTranslation(group.el, node);
            layout ??= new GitHubCodeLayout();
            layout.add(group, node, text);
          },
        };
      });
    },
    clear() {
      layout?.clear();
      layout = null;
    },
  };
}
