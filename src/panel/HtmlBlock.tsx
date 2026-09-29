// Shows model-generated HTML as code or in an opt-in static preview. Sanitizing
// navigation sources complements the iframe sandbox and resource-blocking CSP.

import DOMPurify from 'dompurify';
import { useContext, useMemo, useState } from 'react';
import type { CustomRenderer, CustomRendererProps } from 'streamdown';
import { PartStreamingContext } from './partStreaming';
import { usePanelI18n } from './i18n';

const PREVIEW_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";

// Prepending avoids matching a fake <head> inside untrusted text or attributes.
function buildSrcDoc(code: string): string {
  // CSP does not block a frame navigating itself. Remove navigation targets,
  // nested documents, and SVG animations that could restore link attributes.
  const sanitized = DOMPurify.sanitize(code, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: [
      'base',
      'meta',
      'iframe',
      'frame',
      'frameset',
      'object',
      'embed',
      'template',
      'animate',
      'animatemotion',
      'animatetransform',
      'set',
    ],
    FORBID_ATTR: [
      'href',
      'xlink:href',
      'action',
      'formaction',
      'srcdoc',
      'ping',
    ],
  });
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">${sanitized}`;
}

function HtmlBlock({ code, isIncomplete }: CustomRendererProps) {
  const { messages } = usePanelI18n();
  const [mode, setMode] = useState<'code' | 'preview'>('code');
  // The Markdown parser closes open fences, so also wait for streaming to end.
  const complete = !isIncomplete && !useContext(PartStreamingContext);
  // Build untrusted srcdoc only after the user opens Preview.
  const srcDoc = useMemo(
    () => (mode === 'preview' ? buildSrcDoc(code) : null),
    [code, mode],
  );

  return (
    <div className="html-block" data-streamdown="html-block">
      <div className="html-block-head">
        <span className="html-block-lang">html</span>
        {/* No preview while the fence is still streaming: partial markup would
            render mid-edit and the toggle would churn on every chunk. */}
        {complete && (
          <span
            className="html-toggle"
            role="group"
            aria-label={messages.htmlBlockView}
          >
            <button
              type="button"
              className={mode === 'code' ? 'active' : ''}
              onClick={() => setMode('code')}
            >
              {messages.code}
            </button>
            <button
              type="button"
              className={mode === 'preview' ? 'active' : ''}
              onClick={() => setMode('preview')}
            >
              {messages.preview}
            </button>
          </span>
        )}
      </div>
      {mode === 'preview' && complete && srcDoc !== null ? (
        <iframe
          className="html-preview"
          sandbox=""
          referrerPolicy="no-referrer"
          title={messages.htmlPreview}
          srcDoc={srcDoc}
        />
      ) : (
        <pre className="html-code">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

/** Streamdown renderer for fenced HTML blocks. */
export const htmlRenderer: CustomRenderer = {
  language: 'html',
  component: HtmlBlock,
};
