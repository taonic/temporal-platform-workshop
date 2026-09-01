import type { Snippet as SnippetDef } from '@/course/types';
import { highlight } from '@/lib/highlight';
import { CopyButton } from '@/lib/CopyButton';

/**
 * The answer, behind one click.
 *
 * Disclosure rather than always-visible: one click is enough friction to make
 * pasting-without-reading a choice rather than the default, and five open code
 * blocks would make a lab page mostly code.
 */
export async function Snippet({
  snippet,
  inStep = false,
}: {
  snippet: SnippetDef;
  inStep?: boolean;
}) {
  const html = await highlight(snippet.code, snippet.lang);
  const label = snippet.path ?? snippet.id ?? snippet.lang;

  return (
    <details className={inStep ? 'snippet snippet-instep' : 'snippet'}>
      <summary>
        <span className="snippet-title">
          {snippet.path ? (
            <>
              Show <code>{snippet.path}</code>
            </>
          ) : (
            'Show the commands'
          )}
        </span>
      </summary>

      <div className="snippet-body">
        {snippet.caption && <p className="expect">{snippet.caption}</p>}
        <div className="snippet-tools">
          <span className="chip">{snippet.lang}</span>
          <CopyButton text={snippet.code} label={label} />
        </div>
        {/* Shiki output: server-rendered, no client JS. */}
        <div className="shiki-wrap" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </details>
  );
}
