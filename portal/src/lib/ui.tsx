import type { ReactNode } from 'react';

/**
 * Prose with **bold** and `code`, and nothing else.
 *
 * Deliberately not a markdown renderer. Lab copy needs emphasis and inline
 * identifiers; giving it links and headings as well means lab content starts
 * competing with the page's own structure, and a stray underscore in a namespace
 * name starts italicising half a paragraph.
 */
export function RichText({ children }: { children: string }): ReactNode {
  const parts = children.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i}>{part.slice(1, -1)}</code>;
        }
        return part;
      })}
    </>
  );
}

/** A copyable command block. Multi-line commands are common, so pre-wrap. */
export function CodeBlock({ children }: { children: string }): ReactNode {
  return (
    <pre className="code">
      <code>{children}</code>
    </pre>
  );
}
