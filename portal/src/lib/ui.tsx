import type { ReactNode } from 'react';

import type { SnippetLang } from '@/course/types';
import { CopyButton } from '@/lib/CopyButton';
import { highlight } from '@/lib/highlight';

/**
 * Prose with **bold**, `code`, and bare URLs made clickable. Nothing else.
 *
 * Deliberately not a markdown renderer. Lab copy needs emphasis and inline
 * identifiers; giving it headings as well means lab content starts competing with
 * the page's own structure, and a stray underscore in a namespace name starts
 * italicising half a paragraph.
 *
 * URLs are auto-linked rather than given `[text](url)` syntax, so the address
 * stays readable in the source and a student reading over a shoulder can see
 * where it goes. The trailing character is excluded from the match, or a link at
 * the end of a sentence swallows the full stop.
 *
 * NO capturing group in here. `String.split` emits every capture, so a group
 * nested inside the one below yields each URL twice -- which renders as the link
 * printed back to back with itself.
 */
const URL_RE = /https?:\/\/[^\s)]*[^\s).,;:]/;

export function RichText({ children }: { children: string }): ReactNode {
  const parts = children.split(
    new RegExp(`(\\*\\*[^*]+\\*\\*|\`[^\`]+\`|${URL_RE.source})`, 'g'),
  );
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i}>{part.slice(1, -1)}</code>;
        }
        if (/^https?:\/\//.test(part)) {
          return (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer">
              {part}
            </a>
          );
        }
        return part;
      })}
    </>
  );
}

/** A copyable command block. Multi-line commands are common, so pre-wrap. */
/**
 * A command, highlighted and copyable.
 *
 * Highlighted through the same shiki path the snippets use, rather than a second
 * mechanism: one highlighter, one theme, one place where a language is added. The
 * work happens in a server component and emits HTML, so nothing ships to the
 * browser -- the only client JavaScript on a lab page is the copy button.
 *
 * `bash` for everything by default. Nearly every command block is shell, and the
 * few that are not -- a URL to open, a fragment of expected output -- are short
 * enough that bash's tokeniser leaves them alone.
 */
export async function CodeBlock({
  children,
  lang = 'bash',
}: {
  children: string;
  lang?: SnippetLang;
}): Promise<ReactNode> {
  const html = await highlight(children, lang);
  return (
    <div className="code-wrap">
      <div className="shiki-wrap" dangerouslySetInnerHTML={{ __html: html }} />
      {/* Every one of these is a command someone is about to type, and several are
          five lines long with a Vault lookup in the middle. Retyping one by hand is
          how a typo becomes twenty minutes of debugging the wrong thing. */}
      <div className="code-copy">
        <CopyButton text={children} label="command" />
      </div>
    </div>
  );
}