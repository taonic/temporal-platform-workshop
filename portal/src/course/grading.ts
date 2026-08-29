import { lab } from '@/course';
import { parsePhysicalName, snippetContext } from '@/course/naming';
import type { CheckpointResult, CheckpointStatus, GradeContext, GradeResult } from '@/course/types';
import { readInventory, type CloudNamespace } from '@/platform/cloud';

/**
 * Grade one lab for one student.
 *
 * The account is read once and every checkpoint shares it, so a lab with five
 * checks costs one pair of API calls rather than ten. The training portal learned
 * that the hard way against a 180-requests-per-hour account budget.
 */
export async function gradeLab(n: number, username: string): Promise<GradeResult> {
  const def = lab(n);
  if (!def) throw new Error(`unknown lab ${n}`);

  const inventory = await readInventory();

  // Namespaces belonging to this student. Tag first, name second: the tag is
  // authoritative, and the name check catches one made before the tag existed.
  const mine = inventory.namespaces.filter((ns) => {
    if (ns.tags['username'] === username) return true;
    return parsePhysicalName(ns.spec.name ?? '', username) !== undefined;
  });

  const byEnv = (environment: 'staging' | 'prod'): CloudNamespace | undefined =>
    mine.find(
      (ns) =>
        ns.tags['environment'] === environment ||
        parsePhysicalName(ns.spec.name ?? '', username)?.environment === environment,
    );

  const defs = new Map(def.checkpoints.map((c) => [c.id, c]));
  const build = (id: string, status: CheckpointStatus, observed?: string): CheckpointResult => {
    const d = defs.get(id);
    if (!d) throw new Error(`lab ${n} graded unknown checkpoint id ${id}`);
    return { ...d, selfAttested: d.selfAttested ?? false, status, observed };
  };

  const ctx: GradeContext = {
    ...snippetContext(username),
    mine: () => mine,
    env: byEnv,
    serviceAccounts: () => inventory.serviceAccounts,
    mk: build,
    check: (id, ok, onPass, onFail) => build(id, ok ? 'pass' : 'fail', ok ? onPass : onFail),
    // A self-attested checkpoint always reads as passing and is never counted as
    // verified. Rendering it red would be a lie in the other direction.
    attest: (id) => build(id, 'pass', undefined),
    blockedAll: (reason) => def.checkpoints.map((c) => build(c.id, 'blocked', reason)),
  };

  const results = def.grade(ctx);

  const verifiable = results.filter((r) => !r.selfAttested);
  return {
    lab: n,
    username,
    checkedAtMs: Date.now(),
    results,
    verified: verifiable.filter((r) => r.status === 'pass').length,
    verifiable: verifiable.length,
    attested: results.filter((r) => r.selfAttested).length,
  };
}

export interface CohortRow {
  username: string;
  cohort?: string;
  specs: string[];
  environments: string[];
  namespaces: number;
  driftCorrected: boolean;
  lastState?: string;
}

/**
 * Who is where, for the instructor view.
 *
 * The training portal's README calls this "the fastest way to see who is stuck --
 * a student with no namespace after ten minutes is visible without asking." In a
 * self-paced cohort nobody can walk the room, so it matters more here, not less.
 *
 * It also counts namespaces per student, because the workshop runs 15 students at
 * a peak of three against a quota of 50 with five spare -- so "who is holding
 * four" is a number an instructor needs before the account fills up.
 */
export async function readCohort(): Promise<CohortRow[]> {
  const { namespaces } = await readInventory();
  const byUser = new Map<string, CohortRow>();

  for (const ns of namespaces) {
    // The tag is authoritative; the name is the fallback, and without a known
    // username it splits at the last hyphen -- right for every single-word spec.
    const username = ns.tags['username'] ?? parsePhysicalName(ns.spec.name ?? '')?.username;
    if (!username) continue; // not a workshop namespace
    const parsed = parsePhysicalName(ns.spec.name ?? '', username);
    if (!parsed) continue;

    const row =
      byUser.get(username) ??
      ({
        username,
        specs: [],
        environments: [],
        namespaces: 0,
        driftCorrected: false,
      } as CohortRow);

    row.cohort ??= ns.tags['cohort'];
    row.namespaces += 1;
    if (!row.specs.includes(parsed.spec)) row.specs.push(parsed.spec);
    if (!row.environments.includes(parsed.environment)) row.environments.push(parsed.environment);
    if (ns.tags['drift-corrected-at']) row.driftCorrected = true;
    row.lastState = ns.state;

    byUser.set(username, row);
  }

  return [...byUser.values()].sort((a, b) => a.username.localeCompare(b.username));
}
