/**
 * Write every path-backed snippet to its destination in the repo.
 *
 * This is what keeps the answer key honest now that there is no solutions
 * directory. The snippets in src/course/snippets are the only copy of the answer,
 * so `make verify` emits them into the working tree, compiles and tests them
 * there, and then restores the stubs. A snippet that stops compiling fails CI
 * rather than a student's paste.
 *
 *   pnpm snippets:emit --out ..          # into the repo root
 *   pnpm snippets:emit --out /tmp/check  # somewhere harmless, to look at them
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { LABS } from '../src/course';
import type { SnippetContext } from '../src/course/types';

function outDir(): string {
  const i = process.argv.indexOf('--out');
  return resolve(i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : '..');
}

/**
 * A context built by hand rather than through snippetContext(), which would pull
 * in the env-validated config. Emitting files must work with no environment at
 * all -- CI has no Cloud credential and should not need one.
 *
 * The spec name is `orders` deliberately: it has to match specs/_example.yaml, or
 * the Python golden-fixture test fails against the emitted greeting.py.
 */
const ctx: SnippetContext = {
  username: 'example',
  spec: undefined, // lab 4 falls back to `orders`
  accountId: 'acct1',
  cohort: 'local',
  region: 'aws-ap-southeast-2',
  namespacePattern: 'ws-7-orders-<environment>',
  stagingSuffix: 'ws-7-orders-staging',
  prodSuffix: 'ws-7-orders-prod',
};

async function main(): Promise<void> {
  const root = outDir();
  let written = 0;
  let skipped = 0;

  for (const lab of LABS) {
    for (const snippet of lab.snippets?.(ctx) ?? []) {
      if (!snippet.path) {
        // Illustrative blocks have no file to be. Counted, so a snippet that
        // loses its path by accident is visible rather than silent.
        skipped++;
        continue;
      }
      const target = join(root, snippet.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, snippet.code);
      console.log(`  wrote ${snippet.path}  (lab ${lab.number}, ${snippet.lang})`);
      written++;
    }
  }

  console.log(`\n  ${written} file(s) written, ${skipped} illustrative snippet(s) skipped`);
  if (written === 0) {
    console.error('  no path-backed snippets found -- that cannot be right');
    process.exit(1);
  }
}

// Not top-level await: the package is CommonJS, so tsx transpiles to CJS and
// top-level await is a build error there.
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
