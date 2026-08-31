import type { CloudNamespace, CloudServiceAccount } from '@/platform/cloud';
import type { ReconcilerStatus } from '@/platform/reconciler';

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
   * check script in `instruqt/checks/` does grade them, from inside. A grader that
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

/** Per-student values, derived from the username. Snippets and checks share them. */
export interface SnippetContext {
  /** The name the student chose at the join screen. It names everything downstream. */
  username: string;
  accountId: string;
  /** ws-<username>-<spec>-staging. The spec name is the student's, so this is a pattern. */
  namespacePattern: string;
  stagingSuffix: string;
  prodSuffix: string;
  sandboxUrl?: string;
  /**
   * Cohort id and control-plane region, as the join screen fills them into the
   * `workshop init` line. Present here so a lab prints the SAME command the
   * student was already handed -- a lab that shows a different one turns a paste
   * into a decision.
   */
  cohort: string;
  region: string;
  /**
   * The student's own spec name, read from their namespace tags.
   *
   * Undefined during challenge 1, because they have not chosen it yet -- which is
   * exactly the moment the placeholder is honest rather than unhelpful.
   */
  spec?: string;
}

/** Everything a lab's grade() can read, memoised for the request. */
export interface GradeContext extends SnippetContext {
  /** Namespaces in the account belonging to this student. */
  mine(): CloudNamespace[];
  /** One of the student's namespaces by environment, if it exists yet. */
  env(environment: 'staging' | 'prod'): CloudNamespace | undefined;
  /**
   * The control plane's own namespace, `ws-<username>-control`.
   *
   * Separate from `mine()`, which finds namespaces the PLATFORM made -- by the
   * `username` tag the reconciler writes, or by the ws-<user>-<spec>-<env> shape.
   * The control namespace has neither: a human made it by hand in challenge 1,
   * before there was a reconciler to tag it.
   */
  control(): CloudNamespace | undefined;
  serviceAccounts(): CloudServiceAccount[];
  /**
   * What the reconciler for this student's spec says about itself, or undefined
   * when there is not one to ask.
   *
   * Prefetched, like everything else here, because `grade` is synchronous. This
   * is the only source of platform BEHAVIOUR: reconciles, drifts detected, and
   * what the last drift was. Cloud state can show a namespace is correct; it can
   * never show that a loop noticed it was wrong and fixed it.
   */
  reconciler(): ReconcilerStatus | undefined;
  /**
   * Whether the student has run the prescribed workflow to completion in their
   * own namespace, or undefined when the namespace cannot be reached to ask.
   *
   * Prefetched like everything else, and only for a lab that declares the
   * checkpoint -- it costs a connection to a namespace the other labs have no
   * question about.
   */
  greetingRan(): boolean | undefined;
  mk(id: string, status: CheckpointStatus, observed?: string): CheckpointResult;
  check(id: string, ok: boolean, onPass: string, onFail: string): CheckpointResult;
  attest(id: string): CheckpointResult;
  blockedAll(reason: string): CheckpointResult[];
}

export type SnippetLang = 'hcl' | 'go' | 'python' | 'yaml' | 'bash';

/**
 * A block of code a student can read and paste.
 *
 * Whole files, not fragments. That is partly the training portal's convention --
 * its Session 1 snippet is the entire contents of lab1.tf -- and partly a
 * mechanical requirement: `pnpm snippets:emit` writes every path-backed snippet to
 * its `path`, and `make verify` then compiles and tests it there. A fragment could
 * not be verified, and an unverified answer key rots silently.
 */
export interface Snippet {
  /** Repo-relative destination, and what emit writes. Omit for illustrative blocks. */
  path?: string;
  /** Key a step uses to claim this block, for snippets with no path. */
  id?: string;
  lang: SnippetLang;
  code: string;
  /** One line above the block: what this is and where it goes. */
  caption?: string;
  /**
   * Emit this snippet, but do not render it on the page.
   *
   * For an answer that has to stay compilable without being worth reading. The
   * register.go answer is the case: `make solve` needs it so `verify` compiles
   * what a student ends up with, but the interesting part is the four lines to
   * uncomment -- which the step already shows -- and printing the whole file
   * underneath is noise that invites pasting instead of editing.
   */
  hidden?: boolean;
}

export interface LabStep {
  label: string;
  /**
   * Prose rendered BEFORE the command, when the command only makes sense after
   * something has been said.
   *
   * The default order -- command first, explanation after -- is right for almost
   * every step: a student scanning for the next thing to type should find it at
   * the top. It is wrong when the command consumes something they have to do
   * first, because then the block at the top is a trap they can run too early.
   */
  lead?: string;
  command?: string;
  /** What they should see, so they know to move on. */
  expect?: string;
  /**
   * A list rendered after `expect`, for a step whose result is genuinely several
   * things rather than one paragraph.
   *
   * Structured, rather than `- ` lines inside `expect`, because RichText is
   * deliberately not a markdown renderer -- it does bold, code and URLs and
   * nothing else, so hyphens in a string render as hyphens in a run-on
   * paragraph. Each item still gets RichText, so **bold** and `code` work.
   *
   * Use it sparingly. A step that needs eight bullets is usually two steps.
   */
  bullets?: string[];
  /**
   * Prose after the bullets: the point the list was building to.
   *
   * Only meaningful alongside `bullets` -- without them, it is just `expect`.
   */
  closing?: string;
  /** Checkpoint id this step satisfies; rendered as a badge. */
  grades?: string;
  /**
   * Snippets to render inside this step rather than after the whole list, named by
   * `path` or `id`.
   *
   * Set it on the step that asks for the file. A student on step 2 should not have
   * to scroll past steps 3 to 7 to find the configuration step 2 is talking about
   * -- and having found it, should not have to scroll back.
   *
   * A key that matches no snippet is a build failure, not a silently missing
   * block: `pnpm snippets:check` asserts every claim resolves, and `make verify`
   * runs it. Without that, renaming a file quietly detaches its answer from the
   * step that needs it.
   */
  snippets?: string[];
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
  /**
   * An inline SVG diagram, rendered directly under the intro.
   *
   * For the shape of what a student is about to work on -- which pieces exist,
   * which are inert, and what talks to what. Prose is bad at that and a picture
   * is good at it, which is the whole of the justification.
   *
   * Hand-authored rather than generated; see src/course/diagrams.ts for why, and
   * for the trade that choice makes.
   */
  diagram?: string;
  steps: (ctx: SnippetContext) => LabStep[];
  /**
   * The answer, behind a disclosure. Every lab has one: with no solutions
   * directory in the repo, a lab without a snippet has no reference answer
   * anywhere -- not for a stuck student and not for CI.
   */
  snippets?: (ctx: SnippetContext) => Snippet[];
  checkpoints: CheckpointDef[];
  grade(ctx: GradeContext): CheckpointResult[];
}

export interface GradeResult {
  lab: number;
  username: string;
  checkedAtMs: number;
  results: CheckpointResult[];
  /** Objective only: a self-attested check should not read as verified. */
  verified: number;
  verifiable: number;
  attested: number;
}
