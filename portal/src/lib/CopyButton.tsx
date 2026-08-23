'use client';

import { useState } from 'react';

/**
 * The only client component in a snippet block.
 *
 * "Copied" rather than a silent state change, because a copy button that gives no
 * feedback gets pressed three times.
 */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // Clipboard is blocked over plain HTTP on some hosts. Selecting the
          // block by hand still works, so say nothing rather than throwing.
          setCopied(false);
        }
      }}
      aria-label={`Copy ${label}`}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
