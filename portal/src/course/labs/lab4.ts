import { WORKER_LAYOUT } from '../snippets/excerpts';
import { greetingPy } from '../snippets/greetingPy';
import { DEFAULT_SPEC, GREETING_WORKFLOW } from '../spec-name';
import { LAB4_SVG } from '../diagrams';

import type { LabDef } from '../types';

export const lab4: LabDef = {
  number: 4,
  slug: 'the-paved-road',
  title: 'The paved road',
  outcome: 'A decorator declares a task queue, and the platform deploys the worker.',
  writes: 'worker/workflows/greeting.py',
  feedback: 'cd worker && uv run pytest -m lab',
  minutes: 90,
  intro:
    'Take the platform hat off. You are the product team now: you write a workflow that declares ' +
    'where it runs, and the platform generates the config, the manifest and the deployment.',
  diagram: LAB4_SVG,

  steps: ({ username, accountId }) => [
    {
      label: 'Write the workflow',
      command: 'code worker/workflows/greeting.py',
      snippets: ['worker/workflows/greeting.py'],
      expect:
        'An activity and a workflow, each declaring its task queue in the decorator. That is the ' +
        'whole of your side of the boundary -- which is easier to believe once you have seen the ' +
        'other side.',
    },
    {
      label: 'Now look at what you did not write',
      lead:
        'There is no `worker.py` next to your workflow, and that is not an omission. Look at how ' +
        '`worker/` is actually divided:',
      command: 'ls worker/platform_sdk/',
      snippets: ['worker-layout'],
      expect:
        'The Temporal worker exists -- it is `platform_sdk/main.py`, and it is the platform\'s ' +
        'file, not yours. Its own docstring says why: *"A product team never writes this file. The ' +
        'platform provides it, and the team writes decorated workflows."*\n\n' +
        'Here is what that bought you. None of this appears anywhere in `workflows/`:',
      bullets: [
        '**Connecting.** `Client.connect`, the Cloud address, TLS, and the API key. Your workflow ' +
          'file does not import `temporalio.client` at all.',
        '**The credential.** The worker authenticates to Vault as its own Kubernetes ServiceAccount ' +
          'and reads the namespace key at startup. No token in the manifest, none in the image, ' +
          'and nothing for you to rotate.',
        '**Task queue and namespace wiring.** You named a queue in a decorator. Turning that into ' +
          'a running poller, on the right queue, in the physical namespace the platform chose, is ' +
          '`registry.py` plus the generated config.',
        '**Worker options.** Concurrency, timeouts, the run loop, graceful shutdown -- the settings ' +
          'every team gets wrong once.',
        '**The config and its schema.** `gen-config` reads what your decorators registered and ' +
          'emits it; `schema/workerconfig.schema.json` is the contract, and it is checked on both ' +
          'sides of the language boundary.',
        '**The manifest.** `tpctl worker manifest` templates the Deployment, the ServiceAccount and ' +
          'the Vault role binding.',
      ],
      closing:
        'The benefit is not that this is less typing, though it is. It is that **the platform can ' +
        'change all of it without asking you.** Rotate to a different credential store, upgrade the ' +
        'SDK, add a metrics endpoint or a data converter -- one file changes and every team gets it, ' +
        'because no team forked the worker. That is what lets a handful of people run hundreds of ' +
        'namespaces, and it is the same argument as the generated config: **a boundary you cannot ' +
        'cross by accident is a boundary that can move.**\n\n' +
        'It is also what makes one particular rule enforceable. The worker checks the generated ' +
        'config against what the code actually registered, and **refuses to start** when they ' +
        'disagree -- before it connects to anything. That is only a rule while one worker enforces ' +
        'it; if every team wrote their own, it would be advice.\n\n' +
        'The trade is real, and worth saying out loud: you cannot customise this worker. A paved ' +
        'road is only paved because everyone drives on the same surface, and the moment a team ' +
        'needs something the road does not do, the platform has to add it -- or admit the road ' +
        'stops here. Have that argument now, while the road you just drove on is fresh.',
    },
    {
      label: 'Prove it locally',
      command: 'cd worker && uv run pytest -m lab',
      expect: 'The lab tests go green once the decorators are in place.',
    },
    {
      label: 'Generate the config from the code',
      command: 'tpctl worker gen-config --out worker/worker-config.json',
      expect:
        'Nothing in that file was hand-written. The queues came from your decorators; the owner and ' +
        'service name came from your spec. Config generated from code cannot drift from code.',
    },
    {
      label: 'Look at the k8s manifest before you apply it',
      command: 'tpctl worker manifest -c worker/worker-config.json',
      expect:
        'Printed, not written, because the point is to read it. Four resources, and each one is a ' +
        'decision rather than boilerplate:',
      bullets: [
        '**Namespace** `' + DEFAULT_SPEC + '`, named after your spec. The control plane lives in ' +
          '`platform` and this is somebody else\'s workload; landing in `default` -- which is what ' +
          'happens when a manifest says nothing -- would be an accident. It also makes the Vault ' +
          'binding in the next step mean something: a role bound to this namespace grants your ' +
          'team\'s workers and nobody else\'s.',
        '**ServiceAccount** `' + DEFAULT_SPEC + '-staging-worker`. This is the pod\'s identity, and ' +
          'the whole of its claim to a credential. Vault will be told to trust *this* account in ' +
          '*that* namespace, and nothing else.',
        '**ConfigMap** holding the generated worker config, mounted at `/etc/worker`. Mounted ' +
          'rather than baked in, so "which queue does this worker poll" is answerable with ' +
          '`kubectl get configmap` instead of by pulling an image apart -- and so changing it does ' +
          'not mean a rebuild.',
        '**Deployment**, one replica, with `TEMPORAL_NAMESPACE` and `TEMPORAL_ADDRESS` set for ' +
          'you, a `readinessProbe` on `/healthz`, and **no `TEMPORAL_API_KEY`**. Search the whole ' +
          'file for a secret and you will not find one; the pod authenticates to Vault as its ' +
          'ServiceAccount and fetches the key itself at startup.',
      ],
      closing:
        'The readiness probe is worth a second look. `/healthz` is served only after the worker ' +
        'has connected and started polling, so "not ready" means exactly "not polling" -- not ' +
        '"the process died", which Kubernetes already knew. There is deliberately no liveness ' +
        'probe: a worker that loses its connection retries with backoff, and restarting it ' +
        'mid-retry would replace a recovering worker with a cold start.',
    },
    {
      label: 'Deploy it',
      lead:
        'Now the whole thing in one command, from the worker directory where a developer actually ' +
        'stands:',
      command: `cd worker\ntpctl deploy --config worker-config.json --spec ../specs/${DEFAULT_SPEC}.yaml`,
      expect:
        'Grant, build, load into the cluster, render, apply, wait for the rollout. Nothing there ' +
        'is new -- ' +
        'it is the steps you just ran by hand, in the order you had to know. **Knowing that order ' +
        'is the platform team\'s job**, and collapsing it into one command is what "paved" means.\n\n' +
        'The grant is the step worth pausing on. Before the Deployment exists, `deploy` writes a ' +
        'Vault policy naming **only** this team\'s secrets and a Kubernetes auth role bound to ' +
        '**exactly** this ServiceAccount in **exactly** this namespace. That is what lets the ' +
        'manifest carry no credential: the pod proves who it is and is handed a key nobody typed. ' +
        'Doing it by hand afterwards would leave a window where the Deployment exists and ' +
        'crash-loops -- and leave the grant to a step somebody forgets, which is how a platform ' +
        'ends up with a role bound to `default` because that made the error go away.\n\n' +
        'It also refuses in two cases worth causing on purpose. Point `--spec` at a different ' +
        'spec and it stops before building: a config generated for one namespace deploying against ' +
        'another is a worker polling a queue nobody provisioned. Ask for an environment the spec ' +
        'does not list and it stops for the same reason.',
    },
    {
      label: 'Use it: start a workflow and watch it run',
      lead:
        'Everything so far proves Kubernetes is happy. Nothing yet proves the worker can do the ' +
        'job it was deployed for. Be the caller:',
      command:
        `NS=ws-${username}-${DEFAULT_SPEC}-staging.${accountId}\n` +
        `VP=secret/namespaces/${username}/${DEFAULT_SPEC}/staging\n` +
        `temporal workflow execute \\\n` +
        `  --type ${GREETING_WORKFLOW} --task-queue ${DEFAULT_SPEC}-main \\\n` +
        `  --workflow-id my-first-workflow --input '"workshop"' \\\n` +
        `  --namespace "$NS" \\\n` +
        `  --address "$NS.tmprl.cloud:7233" \\\n` +
        `  --api-key "$(vault kv get -field=api_key $VP)"`,
      expect:
        'It completes, and the result comes back. Three things just happened that nothing before ' +
        'this step could show you:',
      bullets: [
        'The **input deserialised** and the workflow ran the code you wrote in step 1.',
        'The **activity was registered on the queue your decorator named** -- if `gen-config` and ' +
          'the decorators had disagreed, the workflow would have started and then hung with ' +
          'nothing to run it.',
        'The **image in the cluster is the one you built**, not a stale layer.',
      ],
      closing:
        '**The address is the namespace.** Temporal Cloud publishes a per-namespace endpoint -- ' +
        '`<namespace>.tmprl.cloud:7233` -- so there is nothing to look up and nothing to get ' +
        'wrong. The regional endpoints work too, but a namespace is only reachable on **its own** ' +
        'region\'s, and dialling another answers `Request unauthorized`: a routing error wearing ' +
        'a credential error\'s clothes, which sends you off to audit keys that are perfectly ' +
        'fine.\n\n' +
        'Notice the credential. You did not have one, and you still do not: you read it from the ' +
        'Vault path the platform wrote when it provisioned this namespace, for the length of one ' +
        'command. That is the same secret the pod fetches for itself, reached the same way -- and ' +
        'it is the only credential in this challenge that can start a workflow here. The ' +
        'platform\'s own key cannot: it holds management rights over the namespace, not ' +
        'data-plane access to it.',
    },
    {
      label: 'Watch it on Temporal Cloud',
      lead: 'Open the namespace your platform provisioned and find the execution:',
      command: `https://cloud.temporal.io/namespaces/ws-${username}-${DEFAULT_SPEC}-staging.${accountId}/workflows`,
      expect:
        '`my-first-workflow`, completed. Open it and read the **Event History**: the workflow ' +
        'task, the activity scheduled and completed, the result. Then look at the **Workers** tab ' +
        'and find the pod you deployed, holding a poll open.\n\n' +
        'This is the whole paved road in one screen. A decorator declared a task queue; the ' +
        'platform generated a config, a manifest and a namespace; a worker it deployed picked the ' +
        'work up; and none of it involved you writing a client, a Dockerfile, a Deployment, or ' +
        'touching a credential.',
    },
  ],

  snippets: ({ spec }) => [
    {
      id: 'worker-layout',
      lang: 'bash',
      code: WORKER_LAYOUT,
      caption: 'Two packages, one directory. The line between them is the paved road.',
    },
    {
      path: 'worker/workflows/greeting.py',
      lang: 'python',
      code: greetingPy(spec ?? DEFAULT_SPEC),
      caption:
        spec
          ? `The whole file, with the namespace set to your spec (${spec}).`
          : 'The whole file. Change NAMESPACE to your own spec name.',
    },
  ],

  checkpoints: [
    {
      id: 'namespace-still-healthy',
      title: 'The namespace the worker polls is healthy',
      detail: 'A worker cannot poll a namespace that is not there.',
    },
    {
      id: 'greeting-workflow-ran',
      title: `${GREETING_WORKFLOW} has completed in your namespace`,
      detail:
        'The step you just ran, seen from the outside. Everything before it proves Kubernetes ' +
        'is happy; only a completed execution proves the worker can do the job it was deployed ' +
        'for -- the input deserialised, the activity was on the queue your decorator named, and ' +
        'the image in the cluster is the one you built.',
    },
  ],

  grade: (ctx) => {
    const staging = ctx.env('staging');
    if (!staging) return ctx.blockedAll('No namespaces yet -- finish challenge 1 first.');

    return [
      ctx.check(
        'namespace-still-healthy',
        (staging.state ?? '').toLowerCase().includes('activ'),
        `${staging.spec.name} is ${staging.state}`,
        `${staging.spec.name} is ${staging.state ?? 'in an unknown state'}`,
      ),
      // undefined means the namespace could not be asked, which is not the same
      // as an answer of "none" -- but a checkpoint has two colours, and the
      // honest one for "cannot see it" is the same as for "not yet".
      ctx.check(
        'greeting-workflow-ran',
        ctx.greetingRan() === true,
        `A ${GREETING_WORKFLOW} execution has completed in ${staging.spec.name}`,
        ctx.greetingRan() === false
          ? `No completed ${GREETING_WORKFLOW} in ${staging.spec.name} yet -- run step 7`
          : `Cannot reach ${staging.spec.name} to look for a ${GREETING_WORKFLOW} run`,
      ),
    ];
  },
};
