import { createHighlighter, type Highlighter } from 'shiki';
import type { SnippetLang } from '@/course/types';

/**
 * Server-side syntax highlighting.
 *
 * Shiki rather than a hand-rolled tokeniser, because five languages done properly
 * is several hundred lines to maintain against snippets that change -- and
 * half-right highlighting reads as a bug in the portal rather than as a
 * limitation. It runs in a server component and emits HTML, so nothing ships to
 * the browser: no client bundle cost and no runtime dependency in the page.
 *
 * One theme, via CSS variables: the page is dark only -- the brand indigo is
 * built for near-black surfaces -- so a light grammar would never be shown.
 * See `.shiki` in globals.css.
 */

const LANGS: SnippetLang[] = ['hcl', 'go', 'python', 'yaml', 'bash'];

let highlighterPromise: Promise<Highlighter> | undefined;

function highlighter(): Promise<Highlighter> {
  // One instance per process. Loading five grammars per request would make every
  // lab page pay for it.
  highlighterPromise ??= createHighlighter({
    themes: ['github-dark'],
    langs: LANGS,
  });
  return highlighterPromise;
}

const cache = new Map<string, string>();

export async function highlight(code: string, lang: SnippetLang): Promise<string> {
  const key = `${lang}:${code}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const hl = await highlighter();
  const html = hl.codeToHtml(code, {
    lang,
    themes: { dark: 'github-dark' },
    // No baked-in colour: the spans carry --shiki-dark and CSS applies it, which
    // keeps the block on our own surface rather than the theme's background.
    defaultColor: false,
  });

  cache.set(key, html);
  return html;
}
