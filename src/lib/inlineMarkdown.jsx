import React from 'react';

/** Split on **bold** and `inline code` spans (non-greedy, no nested backticks). */
const INLINE_MARKDOWN_RE = /(\*\*(?:[^*]|\*(?!\*))+\*\*|`[^`\n]+`)/g;

/**
 * Turn lightweight markdown in text blocks into React nodes.
 * Supports **bold** and `inline code` only — keeps HTML blocks separate.
 */
export function renderInlineMarkdown(text) {
  if (text == null || text === '') return null;
  const source = String(text);
  const parts = source.split(INLINE_MARKDOWN_RE);

  return parts.map((part, index) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={index} className="dossier-inline-code">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

export function InlineMarkdown({ as: Tag = 'span', className, children }) {
  return <Tag className={className}>{renderInlineMarkdown(children)}</Tag>;
}
