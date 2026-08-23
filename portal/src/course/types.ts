import type { CloudNamespace, CloudServiceAccount } from '@/platform/cloud';

export type CheckpointStatus = 'pass' | 'fail' | 'blocked';

export interface CheckpointDef {
  id: string;
  title: string;
  detail: string;
  /**
   * True when nothing the portal can read proves the claim, so the checkpoint
   * trusts the student and says so.
   *
   * This is not laziness, it is the architecture: a pod on k3s and a secret in
   * Vault exist only inside one sandbox, and nothing central can see them. The
   * Instruqt check for that challenge does grade them, from inside. A grader that
   * implies it verified something it did not is worse than one that admits it.
   */
  selfAttested?: boolean;
  /** Where the objective version of this check lives, when it is not here. */
  gradedBy?: string;
}

export interface CheckpointResult extends CheckpointDef {
  selfAttested: boolean;
  status: CheckpointStatus;
  /** What the portal actually observed, so a red check is diagnosable. */
  observed?: string;
}

/** Per-student values, derived from the slot. Snippets and checks share them. */
export interface SnippetContext {
  participant: string;
  slot: number;
  accountId: string;
  /** ws-<slot>-<spec>-staging. The spec name is the student's, so this is a pattern. */
  namespacePattern: string;
  stagingSuffix: string;
  prodSuffix: string;
  sandboxUrl?: string;
}

/** Everything a lab's grade() can read, memoised for the request. */
export interface GradeContext extends SnippetContext {
  /** Namespaces in the account tagged with this participant. */
  mine(): CloudNamespace[];
  /** One of the participant's namespaces by environment, if it exists yet. */
  env(environment: 'staging' | 'prod'): CloudNamespace | undefined;
  serviceAccounts(): CloudServiceAccount[];
  mk(id: string, status: CheckpointStatus, observed?: string): CheckpointResult;
  check(id: string, ok: boolean, onPass: string, onFail: string): CheckpointResult;
  attest(id: string): CheckpointResult;
  blockedAll(reason: string): CheckpointResult[];
}

export interface LabStep {
  label: string;
  command?: string;
  /** What they should see, so they know to move on. */
  expect?: string;
  /** Checkpoint id this step satisfies; rendered as a badge. */
  grades?: string;
}

export interface LabDef {
  number: number;
  slug: string;
  title: string;
  /** What the student walks away with. */
  outcome: string;
  /** The file they write, if any. Named so nobody hunts for it. */
  writes?: string;
  /** How they know locally whether it worked, before any grader runs. */
  feedback?: string;
  minutes: number;
  intro: string;
  steps: (ctx: SnippetContext) => LabStep[];
  checkpoints: CheckpointDef[];
  grade(ctx: GradeContext): CheckpointResult[];
}

export interface GradeResult {
  lab: number;
  participant: string;
  slot: number;
  checkedAtMs: number;
  results: CheckpointResult[];
  /** Objective only: a self-attested check should not read as verified. */
  verified: number;
  verifiable: number;
  attested: number;
}
