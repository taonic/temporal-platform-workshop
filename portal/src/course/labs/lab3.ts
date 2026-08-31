import { RECONCILER_SWITCH, REGISTER_CHALLENGE_3, WAIT_SELECT } from '../snippets/excerpts';
import { DEFAULT_SPEC } from '../spec-name';
import { LAB3_SVG } from '../diagrams';
import type { LabDef } from '../types';

export const lab3: LabDef = {
  number: 3,
  slug: 'turn-on-the-control-loop',
  title: 'Turn on the control loop',
  outcome: 'A loop that converges on the spec, and notices when reality stops matching it.',
  writes: 'internal/platform/register.go',
  feedback: 'go build ./...',
  minutes: 75,
  intro:
    'What you turned on in challenge 2 runs once and exits. You type a command, a namespace ' +
    'appears, and nothing watches it afterwards -- so a namespace someone edits in the Cloud UI ' +
    'stays edited. The reconciler that fixes that is already written, sitting in the same package, ' +
    'unregistered. Two more lines in the same file, and the driver changes from a command to a ' +
    'loop. Read what the loop does before you turn it on, because the reading is the challenge and ' +
    'the uncommenting takes four seconds.',
  diagram: LAB3_SVG,

  steps: ({ username, accountId }) => {
    // Named by challenge 2, so this lab can say it rather than print <name>.
    const spec = DEFAULT_SPEC;
    return [
    {
      label: 'Read the loop you are about to start',
      lead:
        'Open `internal/platform/workflow/reconciler.go`. `NamespaceWorkflow` is one long-lived ' +
        'entity workflow per logical namespace, and its whole body is a wait and a switch:',
      command: 'code internal/platform/workflow/reconciler.go',
      snippets: ['reconciler-switch'],
      expect:
        'Two inputs, deliberately different in kind.\n\n' +
        '**Intent arrives by SIGNAL.** The post-commit hook signals this workflow, so you get ' +
        'feedback the moment you commit a spec.\n\n' +
        '**Reality arrives by TIMER.** Nobody signals you when somebody edits retention in the ' +
        'Cloud UI. The loop has to go and look.\n\n' +
        'A control plane with only signals converges on what people *said*. One with a timer ' +
        'converges on what is *true*. You need both, and the fingerprint check is what stops the ' +
        'first from firing on every unrelated commit in the repo.',
    },
    {
      label: 'And the wait underneath it',
      lead:
        '`waitForNext` is the four lines that decide what the loop reacts to. It is in ' +
        '`internal/platform/workflow/wait.go`:',
      snippets: ['wait-select'],
      expect:
        '`workflow.NewSelector` and `workflow.NewTimer`, **not** a Go `select` and not ' +
        '`time.After`. Neither of those is deterministic, and a replay would diverge from the ' +
        'recorded history -- which is the single most common way a working workflow becomes a ' +
        'broken one. This is the difference between code that happens to run and code that can ' +
        'be replayed.',
    },
    {
      label: 'Turn it on',
      lead: 'Back in `internal/platform/register.go`, uncomment the challenge 3 block:',
      snippets: ['register-challenge-3'],
      command: 'go build ./... && ./scripts/workshop reload\ntpctl sync',
      expect:
        'Two lines uncommented. `NamespaceWorkflow` is the declarative driver -- the same ' +
        'children and the same activities as challenge 2, driven by a loop instead of by a ' +
        'command. `Inspect` is what lets it ask the Cloud what is actually true; without it the ' +
        'timer fires and the loop has nothing to look with.\n\n' +
        '`tpctl sync` reads every spec in `specs/` and does **signal-with-start** on each one: it ' +
        'creates the reconciler if there is none and signals the one that already exists ' +
        'otherwise. One command, both cases, no "does it exist yet" branch anywhere -- and it ' +
        'returns immediately, because convergence is the reconciler\'s problem now rather than ' +
        'the command\'s.',
      grades: 'reconciler-running',
    },
    {
      label: 'Sync again, and watch nothing happen',
      lead: 'Change nothing, and deliver the same intent a second time:',
      command: `tpctl sync\ntpctl status ${spec}`,
      expect:
        '`reconciles` does NOT go up. The signal arrived and the loop dropped it, because the ' +
        'spec fingerprint is unchanged -- the check you read in the switch two steps ago, doing ' +
        'its job.\n\n' +
        'That matters more than it looks. In the sandbox a git hook runs `tpctl sync` after every ' +
        'commit, including commits that touch nothing in `specs/`. Without the fingerprint check, ' +
        'every commit in the repo would re-apply every namespace in it.',
    },
    {
      label: 'Now go behind the platform\'s back',
      lead:
        'Nobody signals a platform when somebody edits a namespace by hand. Do exactly that. ' +
        'Open your namespace in the Cloud UI:',
      command: `https://cloud.temporal.io/namespaces/ws-${username}-${spec}-staging.${accountId}`,
      expect:
        'Go to **Settings**, change **Retention** to 30 days, and save. Nothing is signalled, ' +
        'nothing is committed, and no command is run. As far as the control plane has been told, ' +
        'the world still matches the spec.\n\n' +
        'This is the case a webhook cannot catch, and it is the reason the loop has a timer at ' +
        'all. A CI job that runs on commit would never hear about this; neither would a `terraform ' +
        'apply` in a pipeline. Reality changed and nobody said so.',
    },
    {
      label: 'Watch the loop put it back',
      lead:
        'Wait for the timer. The drift interval is two minutes by default, so give it that long, ' +
        'then ask the reconciler what it saw:',
      command: `tpctl status ${spec}`,
      expect:
        'Three things move, and they are worth reading in order:',
      bullets: [
        '`driftsDetected` goes up. The timer fired, the Inspect activity asked the Cloud what was ' +
          'actually true, and the answer disagreed with the spec.',
        '`lastDrift` names it: retention is 30 days, the spec asks for 7.',
        '`reconciles` goes up too, because noticing is not the job. The loop ran the same children ' +
          'and the same Terraform activity you turned on in challenge 2 -- there is no separate ' +
          '"repair" path, because converging on the spec is the only thing it ever does.',
      ],
      closing:
        'Reload the Cloud UI and retention is back to 7. Nothing you did fixed it. That gap -- ' +
        'between something being wrong and something being right again, with no human in it -- is ' +
        'the whole difference between a provisioning script and a control plane.',
      grades: 'retention-drift-corrected',
    },
    ];
  },

  snippets: () => [
    {
      id: 'reconciler-switch',
      lang: 'go',
      code: RECONCILER_SWITCH,
      caption: 'internal/platform/workflow/reconciler.go -- already written. Read it, do not change it.',
    },
    {
      id: 'wait-select',
      lang: 'go',
      code: WAIT_SELECT,
      caption: 'internal/platform/workflow/wait.go -- the body of waitForNext.',
    },
    {
      id: 'register-challenge-3',
      lang: 'go',
      code: REGISTER_CHALLENGE_3,
      caption: 'internal/platform/register.go -- remove the // from these two lines.',
    },
  ],

  checkpoints: [
    {
      id: 'reconciler-running',
      title: 'A reconciler is running for your spec',
      detail:
        'ns-<spec>, started by tpctl sync with signal-with-start. It is a long-lived entity ' +
        'workflow: one spec, one workflow, and it outlives every command you type.',
    },
    {
      id: 'retention-drift-corrected',
      title: 'A retention change made behind the platform\'s back was detected and corrected',
      detail:
        'Changed by hand in the Cloud UI, noticed by the timer rather than by a signal, and put ' +
        'back without anyone asking. Graded from the reconciler\'s own query handler, which is ' +
        'the only place that evidence exists.',
    },
  ],

  // Graded from the reconciler's Query handler, not from Cloud state.
  //
  // This is the checkpoint that justifies the whole architecture. The Ops API can
  // say a namespace has 7-day retention; it cannot say the namespace was at 30
  // ten minutes ago and something noticed and put it back. `driftsDetected` and
  // `lastDrift` are that memory, and they exist because the reconciler is a
  // workflow rather than a cron job -- the claim this whole workshop rests on, made
  // checkable here.
  grade: (ctx) => {
    const r = ctx.reconciler();
    if (!r) {
      return ctx.blockedAll(
        'No reconciler to ask. `tpctl sync` starts one, and it has to be running on the ' +
          'control namespace for the portal to reach it.',
      );
    }

    const driftedOnRetention = /retention/i.test(r.lastDrift ?? '');
    const corrected = r.environments.some((e) => e.ok);

    return [
      ctx.check(
        'reconciler-running',
        r.reconciles >= 1,
        `ns-${r.spec.Name}, generation ${r.generation}, ${r.reconciles} reconcile(s)`,
        'the reconciler exists but has never reconciled',
      ),
      ctx.check(
        'retention-drift-corrected',
        r.driftsDetected >= 1 && driftedOnRetention && corrected,
        `${r.driftsDetected} drift(s); last was "${r.lastDrift}", and the environment is healthy again`,
        r.driftsDetected === 0
          ? 'no drift detected yet. Change retention in the Cloud UI and wait for the timer'
          : driftedOnRetention
            ? `drift on retention was seen, but the environment is not healthy yet: ${r.environments.find((e) => !e.ok)?.error ?? 'give the loop another tick'}`
            : `drift was detected, but not on retention: "${r.lastDrift}"`,
      ),
    ];
  },
};
