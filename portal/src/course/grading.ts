import { lab } from '@/course';
import { parsePhysicalName, snippetContext } from '@/course/naming';
import type { CheckpointResult, CheckpointStatus, GradeContext, GradeResult } from '@/course/types';
import { readInventory, type CloudNamespace } from '@/platform/cloud';

/**
 * Grade one lab for one participant.
 *
 * The account is read once and every checkpoint shares it, so a lab with five
 * checks costs one pair of API calls rather than ten. The training portal learned
 * that the hard way against a 180-requests-per-hour account budget.
 */
export async function gradeLab(n: number, participant: string, slot: number): Promise<GradeResult> {
  const def = lab(n);
  if (!def) throw new Error(`unknown lab ${n}`);

  const inventory = await readInventory();

  // Namespaces belonging to this participant. Tag first, name second: the tag is
  // authoritative, and the name check catches a namespace made before the
  // participant tag existed.
  const mine = inventory.namespaces.filter((ns) => {
    if (ns.tags['participant'] === participant) return true;
    const parsed = parsePhysicalName(ns.spec.name ?? '');
    return parsed?.slot === slot;
  });

  const byEnv = (environment: 'staging' | 'prod'): CloudNamespace | undefined =>
    mine.find(
      (ns) =>
        ns.tags['environment'] === environment ||
        parsePhysicalName(ns.spec.name ?? '')?.environment === environment,
    );

  const defs = new Map(def.checkpoints.map((c) => [c.id, c]));
  const build = (id: string, status: CheckpointStatus, observed?: string): CheckpointResult => {
    const d = defs.get(id);
    if (!d) throw new Error(`lab ${n} graded unknown checkpoint id ${id}`);
    return { ...d, selfAttested: d.selfAttested ?? false, status, observed };
  };

  const ctx: GradeContext = {
    ...snippetContext(participant, slot),
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
    participant,
    slot,
    checkedAtMs: Date.now(),
    results,
    verified: verifiable.filter((r) => r.status === 'pass').length,
    verifiable: verifiable.length,
    attested: results.filter((r) => r.selfAttested).length,
  };
}

export interface CohortRow {
  slot: number;
  participant?: string;
  specs: string[];
  environments: string[];
  driftCorrected: boolean;
  lastState?: string;
}

/**
 * Who is where, for the instructor view.
 *
 * The training portal's README calls this "the fastest way to see who is stuck --
 * a student with no namespace after ten minutes is visible without asking." In a
 * self-paced cohort nobody can walk the room, so it matters more here, not less.
 */
export async function readCohort(): Promise<CohortRow[]> {
  const { namespaces } = await readInventory();
  const bySlot = new Map<number, CohortRow>();

  for (const ns of namespaces) {
    const parsed = parsePhysicalName(ns.spec.name ?? '');
    if (!parsed) continue; // not a workshop namespace

    const row =
      bySlot.get(parsed.slot) ??
      ({ slot: parsed.slot, specs: [], environments: [], driftCorrected: false } as CohortRow);

    row.participant ??= ns.tags['participant'];
    if (!row.specs.includes(parsed.spec)) row.specs.push(parsed.spec);
    if (!row.environments.includes(parsed.environment)) row.environments.push(parsed.environment);
    if (ns.tags['drift-corrected-at']) row.driftCorrected = true;
    row.lastState = ns.state;

    bySlot.set(parsed.slot, row);
  }

  return [...bySlot.values()].sort((a, b) => a.slot - b.slot);
}
