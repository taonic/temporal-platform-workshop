import { greetingPy } from '../snippets/greetingPy';
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

  steps: () => [
    {
      label: 'Write the workflow',
      command: 'code worker/workflows/greeting.py',
      snippets: ['worker/workflows/greeting.py'],
      expect:
        'An activity and a workflow, each declaring its task queue in the decorator. Then read the ' +
        'list of what you did not have to write.',
    },
    {
      label: 'Prove it locally',
      command: 'cd worker && uv run pytest -m lab',
      expect: 'The lab tests go green once the decorators are in place.',
    },
    {
      label: 'Generate the config from the code',
      command: 'nsctl worker gen-config --out generated/worker-config.json',
      expect:
        'Nothing in that file was hand-written. The queues came from your decorators; the owner and ' +
        'service name came from your spec. Config generated from code cannot drift from code.',
    },
    {
      label: 'Break it on purpose',
      command: 'cd worker && uv run python -m platform_sdk.main --config ../generated/worker-config.json',
      expect:
        'Comment out the import in workflows/__init__.py first. The worker refuses to start and ' +
        'names what is missing -- not a warning, because a warning in a pod\'s logs is a warning ' +
        'nobody reads.',
    },
    {
      label: 'Deploy it',
      command:
                'nsctl worker manifest -c generated/worker-config.json \\\n' +
        '  --image platform-worker:dev -o deploy/worker.yaml\n' +
        'kubectl apply -f deploy/worker.yaml',
      expect: 'Read the manifest first. There is no credential in it, and none in the image.',
    },
    {
      label: 'Switch Vault to Kubernetes auth',
      expect:
        'The pod will crash-loop, and it should: VAULT_TOKEN does not exist in there. Fifteen lines ' +
        'of Vault config later, the worker authenticates as itself. This is the one moment where ' +
        '"the worker moved into the cluster" has a consequence you must handle rather than watch.',
    },
  ],

  snippets: ({ spec }) => [
    {
      path: 'worker/workflows/greeting.py',
      lang: 'python',
      code: greetingPy(spec ?? 'orders'),
      caption:
        spec
          ? `The whole file, with the namespace set to your spec (${spec}).`
          : 'The whole file. Change NAMESPACE to your own spec name.',
    },
  ],

  checkpoints: [
    {
      id: 'worker-deployed',
      title: 'The worker is running on k3s and polling',
      detail: 'A ready pod, connected to the right queue in the right namespace.',
      selfAttested: true,
      gradedBy: 'the Instruqt check for this challenge, which runs inside your sandbox',
    },
    {
      id: 'credential-via-kubernetes-auth',
      title: 'The credential arrives through Vault Kubernetes auth',
      detail: 'No TEMPORAL_API_KEY in the deployment, and a VAULT_K8S_ROLE that resolves.',
      selfAttested: true,
      gradedBy: 'the Instruqt check, which can read your cluster',
    },
    {
      id: 'namespace-still-healthy',
      title: 'The namespace the worker polls is healthy',
      detail: 'The one part of this challenge the portal can see from outside your sandbox.',
    },
  ],

  grade: (ctx) => {
    const staging = ctx.env('staging');
    if (!staging) return ctx.blockedAll('No namespaces yet -- finish challenge 1 first.');

    return [
      ctx.attest('worker-deployed'),
      ctx.attest('credential-via-kubernetes-auth'),
      ctx.check(
        'namespace-still-healthy',
        (staging.state ?? '').toLowerCase().includes('activ'),
        `${staging.spec.name} is ${staging.state}`,
        `${staging.spec.name} is ${staging.state ?? 'in an unknown state'}`,
      ),
    ];
  },
};
