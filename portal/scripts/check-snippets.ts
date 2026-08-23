/**
 * Assert the lab definitions are internally consistent.
 *
 * Two links can silently rot, and both are the kind that look fine on the page
 * you are editing and wrong on the page you are not:
 *
 *   · a step claiming a snippet key that no longer exists -- rename a file and its
 *     answer detaches from the step that asks for it
 *   · a step whose `grades` names a checkpoint the lab does not declare -- the
 *     training portal was bitten by exactly this: the only step satisfying a
 *     checkpoint sat in a section the page labelled "not graded", so a student
 *     could finish the lab as written and still fail the exit check
 *
 * Neither throws until somebody opens that page, which is why this runs in CI.
 */
import { LABS, snippetKey } from '../src/course';
import type { SnippetContext } from '../src/course/types';

const ctx: SnippetContext = {
  participant: 'ci',
  slot: 7,
  accountId: 'acct1',
  namespacePattern: 'ws-7-orders-<environment>',
  stagingSuffix: 'ws-7-orders-staging',
  prodSuffix: 'ws-7-orders-prod',
};

const problems: string[] = [];
let claims = 0;

for (const lab of LABS) {
  const snippets = lab.snippets?.(ctx) ?? [];
  const keys = new Set(snippets.map(snippetKey));
  const checkpointIds = new Set(lab.checkpoints.map((c) => c.id));
  const steps = lab.steps(ctx);

  for (const snippet of snippets) {
    if (!snippetKey(snippet)) {
      problems.push(`lab ${lab.number}: a snippet has neither path nor id, so no step can claim it`);
    }
  }

  const claimed = new Set<string>();
  for (const step of steps) {
    for (const key of step.snippets ?? []) {
      claims++;
      claimed.add(key);
      if (!keys.has(key)) {
        problems.push(
          `lab ${lab.number} step "${step.label}" claims snippet "${key}", ` +
            `which does not exist. Known: ${[...keys].join(', ') || 'none'}`,
        );
      }
    }
    if (step.grades && !checkpointIds.has(step.grades)) {
      problems.push(
        `lab ${lab.number} step "${step.label}" grades checkpoint "${step.grades}", ` +
          `which the lab does not declare. Known: ${[...checkpointIds].join(', ')}`,
      );
    }
  }

  // Not a failure: an unclaimed snippet still renders after the step list. Worth
  // reporting, because "I put it inline" and "it fell to the bottom" look the same
  // until you load the page.
  for (const key of keys) {
    if (!claimed.has(key)) {
      console.log(`  note: lab ${lab.number} snippet "${key}" is unclaimed and renders after the steps`);
    }
  }
}

if (problems.length > 0) {
  console.error('\nlab definitions are inconsistent:\n  - ' + problems.join('\n  - ') + '\n');
  process.exit(1);
}
console.log(`  ok: ${LABS.length} labs, ${claims} snippet claim(s), every claim and grade resolves`);
