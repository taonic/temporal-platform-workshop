import { WAIT_GO } from '../snippets/waitGo';
import type { LabDef } from '../types';

export const lab3: LabDef = {
  number: 3,
  slug: 'invert-to-declarative',
  title: 'Invert to declarative',
  outcome: 'A control loop that converges on the spec, and notices when reality stops matching it.',
  writes: 'internal/platform/wait.go',
  feedback: 'go test ./internal/platform/...',
  minutes: 75,
  intro:
    'The reconciler exists. It has the loop, the reconcile, the drift check and the query handler. ' +
    'It is missing the four lines that decide what it reacts to.',

  steps: () => [
    {
      label: 'Write the wait',
      command: 'code internal/platform/wait.go',
      expect:
        'Block until one of three things happens -- a spec on applyCh, a destroy on destroyCh, or ' +
        'the deadline -- and say which. Use workflow.NewTimer and workflow.NewSelector, not a Go ' +
        'select and not time.After: neither is deterministic, and a replay would diverge.',
    },
    {
      label: 'Prove both halves locally',
      command: 'go test ./internal/platform/...',
      expect:
        'TestReconcilerDetectsAndCorrectsDrift proves the timer half. ' +
        'TestReconcilerIgnoresAnApplyThatChangesNothing proves the signal half.',
    },
    {
      label: 'Deliver intent by committing',
      command: 'git add specs && git commit -m "ask for a namespace"',
      expect:
        'The post-commit hook ran nsctl sync, which does signal-with-start on ns-<name>. First ' +
        'commit creates the reconciler; every later commit signals the one that already exists. ' +
        'Note it did not wait -- convergence is the reconciler\'s problem now.',
    },
    {
      label: 'Commit something unrelated, and watch nothing happen',
      command: 'nsctl status <name>',
      expect:
        'reconciles does NOT go up: the spec fingerprint is unchanged. Without that check, every ' +
        'commit in the repo would re-apply every namespace.',
    },
    {
      label: 'Now go behind the platform\'s back',
      expect:
        'Open the Temporal Cloud UI, find your staging namespace, and change its retention by hand. ' +
        'Nobody committed anything and no signal will arrive. Then wait for the timer.',
      grades: 'drift-corrected',
    },
    {
      label: 'Watch the loop catch you',
      command: "watch -n 10 'nsctl status <name>'",
      expect:
        'driftsDetected goes up, lastDrift names what you did, and the retention goes back. ' +
        'Signals carry intent; the timer catches reality.',
    },
    {
      label: 'Remove an environment from the spec and commit',
      expect:
        'It is destroyed. Convergence means removing what is no longer desired, not only adding ' +
        'what is -- the half people forget.',
    },
  ],

  snippets: () => [
    {
      path: 'internal/platform/wait.go',
      lang: 'go',
      code: WAIT_GO,
      caption: 'The whole file. The event enum above waitForNext is unchanged.',
    },
  ],

  checkpoints: [
    {
      id: 'drift-corrected',
      title: 'The loop caught a change nobody committed',
      detail:
        'Tagged drift-corrected-at. The reconciler stamps this when the timer finds reality has ' +
        'diverged from the spec and corrects it -- which is the only part of a control loop that a ' +
        'signal alone can never do.',
    },
    {
      id: 'retention-reconverged',
      title: 'Retention is back where the spec says',
      detail: 'Detecting drift is not the point. Correcting it is.',
    },
    {
      id: 'reconciler-owns-the-tags',
      title: 'The tag set is still complete',
      detail:
        'temporalcloud_namespace_tags manages the whole set, so a partial write silently deletes ' +
        'the rest. owner, tier, environment, spec and participant should all still be there.',
    },
  ],

  grade: (ctx) => {
    const staging = ctx.env('staging');
    if (!staging) return ctx.blockedAll('No namespaces yet -- finish challenge 1 first.');

    const tags = staging.tags;
    const stamped = tags['drift-corrected-at'];
    const expected = ['owner', 'tier', 'environment', 'spec', 'participant', 'provisioner'];
    const missing = expected.filter((k) => !tags[k]);

    return [
      ctx.check(
        'drift-corrected',
        Boolean(stamped),
        `stamped at ${stamped}`,
        'no drift-corrected-at tag yet. Change retention in the Cloud UI and wait one drift interval (2 min by default)',
      ),
      ctx.check(
        'retention-reconverged',
        typeof staging.spec.retentionDays === 'number' && Boolean(stamped),
        `retention is ${staging.spec.retentionDays} days after correction`,
        'nothing to reconverge yet -- cause some drift first',
      ),
      ctx.check(
        'reconciler-owns-the-tags',
        missing.length === 0,
        `all ${expected.length} keys present`,
        `missing: ${missing.join(', ')} -- the module must pass the complete var.tags through`,
      ),
    ];
  },
};
