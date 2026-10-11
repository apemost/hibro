// Mirrors GitHub's highlighted file view with virtual or flow React rows and
// legacy table cells. Strings containing comment syntax are not comments.
export function githubCodePage(
  layout: 'react' | 'flow' | 'nonvirtual' | 'table',
  lines = [
    '\t<span class="pl-c">// Detect a mount point.</span>',
    '\t<span class="pl-c">// Return an error if the path is missing.</span>',
    '<span class="pl-c">//</span>',
    'url := <span class="pl-s">"https://example.com//not-a-comment"</span>',
    'case nil: <span class="pl-c">// Definitely not a mount<span hidden>hidden child</span></span>',
    'value := 1 <span class="pl-c">/* Ignore this trailing block</span>',
    '<span class="pl-c"> * and its continuation */</span>',
    '  <span class="pl-c">/*</span>',
    '  <span class="pl-c"> * A block comment</span>',
    '  <span class="pl-c"> * with <span class="pl-c">nested highlighting</span></span>',
    '  <span class="pl-c"> */</span>',
    'return true, nil',
  ],
): string {
  const rows = lines.map((line, index) => {
    const n = index + 1;
    if (layout === 'nonvirtual')
      return `<div id="LC${n}" class="react-code-text react-code-line-contents-no-virtualization react-file-line" inert>${line}</div>`;
    return layout !== 'table'
      ? `<div class="react-code-text react-code-line-contents${layout === 'react' ? ' virtual' : ''}"${layout === 'react' ? ` style="top:${index * 20}px"` : ''}><div><div id="LC${n}" class="react-file-line" data-line-number="${n}" inert>${line}</div></div></div>`
      : `<tr><td id="L${n}" class="blob-num" data-line-number="${n}">${n}</td><td id="LC${n}" class="blob-code blob-code-inner">${line}</td></tr>`;
  });
  const hidden =
    '<div class="react-file-line" hidden><span class="pl-c">// Hidden duplicate</span></div><div class="react-file-line" style="visibility:hidden"><span class="pl-c">// Invisible duplicate</span></div><div class="react-file-line" aria-hidden="true"><span class="pl-c">// Hidden semantic duplicate</span></div>';
  const code =
    layout !== 'table'
      ? `<div class="react-code-file-contents" role="presentation" aria-hidden="true" ${layout === 'nonvirtual' ? '' : `style="height:${lines.length * 20}px"`}><div class="${layout === 'nonvirtual' ? 'react-line-numbers-no-virtualization' : 'react-line-numbers'}" ${layout === 'nonvirtual' ? '' : `style="height:${lines.length * 20}px"`}>${layout === 'nonvirtual' ? '<div class="number-chunk">' : ''}${lines.map((_, i) => `<div class="react-line-number${layout === 'react' ? ' virtual' : ''}" data-line-number="${i + 1}"${layout === 'react' ? ` style="top:${i * 20}px"` : ''}>${i + 1}</div>`).join('')}${layout === 'nonvirtual' ? '</div>' : ''}</div><div class="react-code-lines" ${layout === 'nonvirtual' ? '' : `style="height:${lines.length * 20}px"`}>${rows.join('')}${hidden}</div></div>`
      : `<table class="highlight"><tbody>${rows.join('')}<tr hidden><td class="blob-code"><span class="pl-c">// Hidden duplicate</span></td></tr></tbody></table>`;
  return `<!doctype html><html><head><title>GitHub code fixture</title>
    <style>
      .code-scroller { position: relative; width: min(700px, 100%); overflow: auto; }
      .code-editor { position: relative; }
      .react-code-file-contents { display: flex; position: relative; pointer-events: none; }
      .react-line-numbers, .react-line-numbers-no-virtualization { position: relative; width: 40px; flex-shrink: 0; pointer-events: auto; z-index: 2; }
      .react-line-numbers-no-virtualization { display: flex; flex-direction: column; align-items: flex-end; }
      .react-code-line-contents-no-virtualization { position: relative; min-height: 20px; }
      .number-chunk { content-visibility: auto; contain-intrinsic-height: auto 1200px; }
      .react-line-number { position: relative; font: 14px/20px monospace; }
      .react-code-lines { position: relative; flex: 1; min-width: 0; }
      .react-code-line-contents { position: relative; min-height: 20px; display: flex; }
      .virtual { position: absolute; }
      .react-file-line, .blob-code { white-space: pre; font: 14px/20px monospace; }
      .pl-c { color: rgb(90, 100, 110); }
      table { border-spacing: 0; } td { padding: 0; }
      textarea { position: absolute; inset: 0; width: 100%; height: 180px; opacity: 0; z-index: 1; }
    </style></head><body><main><h1>example.go</h1>
    <nav><span class="pl-c">Navigation is not a code comment</span></nav>
    <div class="code-editor">${layout !== 'table' ? '<div style="display:contents"><textarea id="read-only-cursor-text-area" aria-label="file content" readonly>Original source buffer</textarea></div>' : ''}<div class="code-scroller">${code}</div></div>
    <pre><code><span class="pl-c">// Unrelated code sample</span></code></pre>
    </main></body></html>`;
}
