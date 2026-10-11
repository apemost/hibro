// GitHub keeps code and line numbers in separate columns. Reserve translation
// space for both virtual and flow rows without changing source line IDs.
const TRANSLATION = '[data-hibro-translation]';

/** Original comment syntax, indentation, and longest source line width in em. */
export interface CommentSyntax {
  prefix: string;
  suffix: string;
  widthEm: number;
  indent: string;
  singleLine: boolean;
}

interface SavedStyle {
  value: string;
  priority: string;
  applied: string;
  requested: string;
}

/** Owns reversible spacing for unnumbered translations in GitHub code views. */
export class GitHubCodeLayout {
  private roots = new Set<HTMLElement>();
  private translations = new Map<
    { el: HTMLElement; comment?: CommentSyntax },
    {
      node: HTMLElement;
      root: HTMLElement;
      original: string;
      text: string;
    }
  >();
  private styles = new Map<HTMLElement, Map<string, SavedStyle>>();
  private attributes = new Map<HTMLElement, Map<string, string | null>>();
  private heights = new Map<HTMLElement, number>();
  private frame = 0;
  private measure = document.createElement('canvas').getContext('2d')!;
  private words = new Intl.Segmenter(undefined, { granularity: 'word' });
  private graphemes = new Intl.Segmenter(undefined, {
    granularity: 'grapheme',
  });
  private resize = new ResizeObserver(() => this.schedule());
  private mutations = new MutationObserver(() => this.schedule());

  /** Registers a translated source row and synchronizes both code columns. */
  add(
    source: { el: HTMLElement; comment?: CommentSyntax },
    node: HTMLElement,
    text: string,
  ): void {
    const root = source.el.closest<HTMLElement>(
      '.react-code-file-contents, table',
    );
    if (!root) return;
    const previous = this.translations.get(source);
    if (previous) this.resize.unobserve(previous.node);
    this.translations.set(source, {
      node,
      root,
      text,
      original: Array.from(source.el.childNodes)
        .filter((child) => child !== node)
        .map((child) => child.textContent ?? '')
        .join(''),
    });
    if (!this.roots.has(root)) {
      this.roots.add(root);
      this.resize.observe(root.parentElement ?? root);
      this.mutations.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden', 'inert'],
      });
    }
    node.style.marginBlockStart = '0';
    node.style.paddingBlock = '0.35em';
    node.style.whiteSpace = 'pre';
    node.style.overflowWrap = 'normal';
    node.style.boxSizing = 'border-box';
    this.resize.observe(node);
    this.update();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update();
    });
  }

  private style(el: HTMLElement, property: string): SavedStyle {
    let properties = this.styles.get(el);
    if (!properties) {
      properties = new Map();
      this.styles.set(el, properties);
      this.rememberAttribute(el, 'style');
    }
    const value = el.style.getPropertyValue(property);
    let saved = properties.get(property);
    if (!saved || value !== saved.applied) {
      // React can update its own dimensions after folding or navigation.
      saved = {
        value,
        priority: el.style.getPropertyPriority(property),
        applied: value,
        requested: value,
      };
      properties.set(property, saved);
    }
    return saved;
  }

  private setStyle(el: HTMLElement, property: string, value: string): void {
    const saved = this.style(el, property);
    if (saved.requested === value) return;
    el.style.setProperty(property, value);
    // CSSOM normalizes values (e.g. 0 0px to 0px). Comparing the requested
    // spelling with the DOM would treat our own writes as page changes.
    saved.applied = el.style.getPropertyValue(property);
    saved.requested = value;
  }

  private rememberAttribute(el: HTMLElement, name: string): void {
    let attributes = this.attributes.get(el);
    if (!attributes) {
      attributes = new Map();
      this.attributes.set(el, attributes);
    }
    if (!attributes.has(name)) attributes.set(name, el.getAttribute(name));
  }

  private expose(el: HTMLElement, attribute: string): void {
    if (!el.hasAttribute(attribute)) return;
    this.rememberAttribute(el, attribute);
    el.removeAttribute(attribute);
  }

  private expand(el: HTMLElement, extra: number): void {
    const original = this.style(el, 'height').value;
    if (!this.heights.has(el))
      this.heights.set(el, el.getBoundingClientRect().height);
    const height = original.endsWith('px')
      ? parseFloat(original)
      : this.heights.get(el)!;
    this.setStyle(el, 'height', `${height + extra}px`);
  }

  // Keep actual newline characters and a marker on every line, including when
  // copied. Prefer word boundaries; split oversized words only at graphemes so
  // CJK text, combining marks, and emoji remain intact.
  private commentLines(
    text: string,
    syntax: CommentSyntax,
    width: number,
    indentWidth: number,
  ): string {
    if (syntax.singleLine) {
      return `${syntax.indent}${syntax.prefix} ${text} ${syntax.suffix}`;
    }
    const block = /^(?:\/\*|<!--)/.test(syntax.prefix);
    const marker = block
      ? syntax.prefix.startsWith('/*')
        ? ' * '
        : ''
      : syntax.prefix
        ? `${syntax.prefix} `
        : '';
    const prefix = syntax.indent + marker;
    const tokens: string[] = [];
    for (const { segment } of this.words.segment(text)) {
      // Segmenter splits paths and dotted identifiers at punctuation. Keep
      // contiguous ASCII tokens together unless the whole token cannot fit.
      const previous = tokens.at(-1);
      if (
        previous &&
        ((/^[!-~]+$/.test(previous) && /^[!-~]+$/.test(segment)) ||
          /^[,.;:!?，。；：！？、)\]}»”’]+$/u.test(segment))
      )
        tokens[tokens.length - 1] += segment;
      else tokens.push(segment);
    }
    const lines: string[] = [];
    let line = '';
    const fits = (value: string) =>
      indentWidth + this.measure.measureText(marker + value).width <= width;
    for (const token of tokens) {
      if (fits(line + token)) {
        line += token;
        continue;
      }
      if (line.trim()) lines.push(prefix + line.trimEnd());
      line = token.trimStart();
      if (!fits(line)) {
        line = '';
        for (const { segment } of this.graphemes.segment(token.trimStart())) {
          if (line && !fits(line + segment)) {
            lines.push(prefix + line);
            line = '';
          }
          line += segment;
        }
      }
    }
    if (line.trim()) lines.push(prefix + line.trimEnd());
    if (block) {
      lines.unshift(syntax.indent + syntax.prefix);
      if (syntax.suffix)
        lines.push(
          syntax.indent + (syntax.suffix === '*/' ? ' */' : syntax.suffix),
        );
    }
    return lines.join('\n');
  }

  private update(): void {
    // Folding removes rows and expansion creates fresh ones. Reattach only
    // when the same source text returns inside the same code view, updating
    // the shared source reference used by cached restore and later batches.
    for (const [source, { node, root, original }] of this.translations) {
      if (node.isConnected || !root.isConnected) continue;
      const replacement = document.getElementById(source.el.id);
      if (
        replacement &&
        root.contains(replacement) &&
        replacement.textContent === original
      ) {
        source.el = replacement;
        replacement.append(node);
      }
    }
    for (const root of this.roots) {
      if (!root.isConnected) continue;
      const scroller = root.parentElement!;
      const left = scroller.getBoundingClientRect().left - scroller.scrollLeft;
      for (const [source, entry] of this.translations) {
        const { node, text } = entry;
        if (entry.root !== root || !node.isConnected) continue;
        const row = node.parentElement!;
        let width = Math.max(
          40,
          Math.floor(
            scroller.clientWidth -
              (row.getBoundingClientRect().left - left) -
              16,
          ),
        );
        const style = getComputedStyle(node);
        this.measure.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        if (source.comment) {
          const cell = this.measure.measureText('0').width;
          // Canvas treats tabs as spaces; CSS expands them to the next tab
          // stop. Measure indentation separately using the page's tab size.
          const tabWidth = Math.max(
            1,
            parseFloat(style.tabSize) *
              (style.tabSize.endsWith('px')
                ? 1
                : this.measure.measureText(' ').width),
          );
          const indentParts = source.comment.indent.split('\t');
          let indentWidth = 0;
          for (let i = 0; i < indentParts.length; i++) {
            indentWidth += this.measure.measureText(indentParts[i]).width;
            if (i < indentParts.length - 1)
              indentWidth = (Math.floor(indentWidth / tabWidth) + 1) * tabWidth;
          }
          // Follow source formatting without letting a wide browser turn a
          // whole paragraph into one long comment. Short source lines still
          // leave enough room for translated words and their markers.
          width = Math.floor(
            Math.min(
              width,
              80 * cell,
              indentWidth +
                Math.max(
                  30 * cell,
                  source.comment.widthEm * parseFloat(style.fontSize),
                ),
            ),
          );
          const formatted = this.commentLines(
            text,
            source.comment,
            width,
            indentWidth,
          );
          if (node.textContent !== formatted) node.textContent = formatted;
        }
        const value = `${width}px`;
        if (node.style.width !== value) node.style.width = value;
      }
      if (root.tagName === 'TABLE') {
        for (const number of root.querySelectorAll<HTMLElement>('.blob-num')) {
          this.setStyle(number, 'vertical-align', 'top');
        }
        continue;
      }

      // The invisible source textarea assumes constant line heights. Let the
      // visible DOM handle mouse selection while keeping its source buffer and
      // keyboard access intact. Expose the bilingual code to screen readers.
      this.setStyle(root, 'pointer-events', 'auto');
      this.expose(root, 'aria-hidden');
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '#read-only-cursor-text-area',
      );
      if (textarea) this.setStyle(textarea, 'pointer-events', 'none');
      const gutter = root.querySelector<HTMLElement>(
        '.react-line-numbers, .react-line-numbers-no-virtualization',
      );
      const code = root.querySelector<HTMLElement>('.react-code-lines');
      if (!gutter || !code) continue;
      const numbers = new Map(
        Array.from(
          gutter.querySelectorAll<HTMLElement>('[data-line-number]'),
          (el) => [el.dataset.lineNumber, el],
        ),
      );
      let extra = 0;
      for (const row of code.querySelectorAll<HTMLElement>(
        '.react-file-line',
      )) {
        const wrapper =
          row.closest<HTMLElement>('.react-code-line-contents') ?? row;
        this.expose(row, 'inert');
        // Flow rows already move when a preceding translation grows. Only
        // absolutely positioned rows need the additional translation offset.
        this.setStyle(
          wrapper,
          'translate',
          getComputedStyle(wrapper).position === 'absolute'
            ? `0 ${extra}px`
            : 'none',
        );
        const number = numbers.get(
          row.dataset.lineNumber ?? row.id.replace(/^LC/, ''),
        );
        if (number) {
          // Align to the rendered source, rather than assuming both columns
          // have identical base positions after GitHub reflows its rows.
          const numberStyle = getComputedStyle(number);
          const absolute = numberStyle.position === 'absolute';
          const previous =
            parseFloat(
              absolute
                ? (numberStyle.translate.split(/\s+/)[1] ?? '0')
                : numberStyle.marginTop,
            ) || 0;
          const offset =
            row.getBoundingClientRect().top -
            number.getBoundingClientRect().top +
            previous;
          // Flow gutters use content-visibility groups that clip translated
          // descendants. Real margins grow those groups along with the code.
          this.setStyle(
            number,
            absolute ? 'translate' : 'margin-top',
            absolute ? `0 ${offset}px` : `${offset}px`,
          );
        }
        for (const node of row.querySelectorAll<HTMLElement>(
          `:scope > ${TRANSLATION}`,
        )) {
          if (getComputedStyle(node).visibility !== 'hidden')
            extra += node.getBoundingClientRect().height;
        }
      }
      // Nonvirtualized columns grow naturally with their source rows.
      // Expanding them again would count the translation height twice.
      if (!gutter.classList.contains('react-line-numbers-no-virtualization')) {
        this.expand(code, extra);
        this.expand(gutter, extra);
        this.expand(root, extra);
      }
    }
  }

  /** Stops observers and restores only styles and attributes owned by Hibro. */
  clear(): void {
    this.resize.disconnect();
    this.mutations.disconnect();
    cancelAnimationFrame(this.frame);
    for (const [el, properties] of this.styles) {
      for (const [property, saved] of properties) {
        if (el.style.getPropertyValue(property) === saved.applied) {
          if (saved.value)
            el.style.setProperty(property, saved.value, saved.priority);
          else el.style.removeProperty(property);
        }
      }
    }
    for (const [el, attributes] of this.attributes) {
      for (const [name, value] of attributes) {
        if (name === 'style') {
          // Read the attribute to flush CSSOM's lazy serialization before
          // removing it; otherwise Chromium can recreate an empty attribute.
          if (value === null && el.getAttribute('style') === '')
            el.removeAttribute('style');
        } else if (!el.hasAttribute(name) && value !== null) {
          el.setAttribute(name, value);
        }
      }
    }
    this.roots.clear();
    this.translations.clear();
  }
}
