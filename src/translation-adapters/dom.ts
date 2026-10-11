// Shared DOM rules for translation sources and inserted text.
export const TRANSLATION_BLOCK_ATTR = 'data-hibro-block';
export const TRANSLATION_NODE_ATTR = 'data-hibro-translation';

// Block tags that carry body text. A translation is rendered under each of
// them, so the page reads as one source block followed by its translation.
export const TRANSLATABLE_BLOCK_SELECTOR =
  'p,h1,h2,h3,h4,h5,h6,li,dd,dt,blockquote,figcaption,td,th,summary';

// Page furniture and hidden text are never translation sources.
export const TRANSLATION_SKIP_SELECTOR =
  'nav,aside,footer,kbd,samp,script,style,noscript,textarea,svg,[contenteditable="true"],[hidden]';

/** Checks rendered visibility, including nodes outside the current viewport. */
export function isVisibleChild(el: Element): boolean {
  if (el.getClientRects().length === 0) return false;
  return getComputedStyle(el).visibility !== 'hidden';
}

// Whether a child node belongs to this block's own text. Nested blocks (a list
// item's sub-list, a table cell's paragraph) are translated on their own, and
// translations Hibro already inserted are never re-read as source text.
// Children the reader cannot see are dropped too: documentation themes hang a
// permalink anchor off every heading and keep it visibility:hidden until
// hover, and its pilcrow would otherwise be sent to the model as part of the
// heading text.
function ownsChildNode(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return true;
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as Element;
  if (el.hasAttribute(TRANSLATION_NODE_ATTR)) return false;
  if (!isVisibleChild(el)) return false;
  return (
    !el.matches(TRANSLATABLE_BLOCK_SELECTOR) &&
    !el.querySelector(TRANSLATABLE_BLOCK_SELECTOR)
  );
}

// The text a block owns directly.
export function ownBlockText(el: HTMLElement): string {
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (!ownsChildNode(node)) continue;
    text += node.textContent || '';
  }
  return text.replace(/\s+/g, ' ').trim();
}

// The child the translation is inserted before, or null to append it last.
// It goes before the first nested block (so a list item's translation lands
// above its sub-list, not after it) and otherwise at the very end. Appending
// last matters for trailing inline content the block does not own: a
// documentation theme's hidden permalink anchor would otherwise be pushed
// past the block-level translation and take a blank line of its own.
function translationAnchor(el: HTMLElement): Node | null {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const child = node as Element;
    if (child.hasAttribute(TRANSLATION_NODE_ATTR)) continue;
    if (
      child.matches(TRANSLATABLE_BLOCK_SELECTOR) ||
      child.querySelector(TRANSLATABLE_BLOCK_SELECTOR)
    ) {
      return child;
    }
  }
  return null;
}

// A phrasing-content span is valid inside every block tag this feature targets,
// and CSSOM properties survive a page CSP that would drop an injected
// stylesheet or a style attribute. The translation inherits the block's own
// styling and is separated by spacing alone, so it reads as part of the page
// rather than as an annotation stuck onto it. dir="auto" keeps right-to-left
// targets readable under a left-to-right source block.
export function buildTranslationNode(
  text: string,
  language?: string,
): HTMLSpanElement {
  const node = document.createElement('span');
  node.setAttribute(TRANSLATION_NODE_ATTR, '');
  if (language) node.lang = language;
  node.dir = 'auto';
  node.textContent = text;
  node.style.display = 'block';
  node.style.marginBlockStart = '0.35em';
  return node;
}

/** Replaces a block's existing translation without moving its other children. */
export function insertTranslation(el: HTMLElement, node: HTMLElement): void {
  el.querySelector(`:scope > [${TRANSLATION_NODE_ATTR}]`)?.remove();
  el.insertBefore(node, translationAnchor(el));
}
