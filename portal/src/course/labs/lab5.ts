import type { LabDef } from '../types';

export const lab5: LabDef = {
  number: 5,
  slug: 'be-the-developer',
  title: 'Be the developer',
  outcome: 'Time to first workflow, measured on yourself.',
  minutes: 45,
  intro:
    "OpenAI's platform team measured one number: time to first workflow. It was one to two weeks; " +
    'after the paved road, a day. You have spent four challenges building a platform and have not ' +
    'once used it as a customer. Empty directory. Stopwatch. Go.',

  steps: ({ slot }) => [
    {
      label: 'Start the clock',
      command: 'date +%s > /tmp/started',
      expect: 'You are a developer on a different team. You have heard there is a platform.',
    },
    {
      label: 'Get a workflow to complete',
      expect:
        'Use only what the platform gives you: nsctl, the decorators, the generated config. Do not ' +
        'open the Cloud UI, write Terraform, or touch a credential.',
      grades: 'second-namespace',
    },
    {
      label: 'Stop the clock',
      command: 'echo $(( $(date +%s) - $(cat /tmp/started) )) seconds',
      expect: 'Compare it to one-to-two weeks.',
    },
    {
      label: `Look at what slot ${slot} now holds`,
      command: 'nsctl slot status',
      expect:
        'Then have the argument: you built the same control loop OpenAI built as a Kubernetes ' +
        'operator. You never wrote a lock, because the workflow id was the resource identity. And ' +
        'if retention changes above 30 days needed approval tomorrow, that is a signal and an ' +
        'Await -- not a new controller.',
    },
  ],

  // Illustrative, and no path: there is no file for the platform's own customer to
  // write. It is also the one snippet that undermines its own challenge, so the
  // disclosure says so -- the point of a stopwatch is that you ran the race.
  snippets: ({ slot }) => [
    {
      lang: 'bash',
      caption: 'The whole paved road, as a developer walks it. Using this stops the clock being meaningful.',
      code: [
        '# You are a developer on a new team. You have an empty directory.',
        'nsctl new --non-interactive --name payments --owner risk-team --retention 7',
        'nsctl apply -f specs/payments.yaml',
        '',
        '# Two namespaces and two credentials exist now. Write a workflow:',
        '#   worker/workflows/payments.py, decorated for task queue payments-main',
        '#   and namespace payments -- then import it in workflows/__init__.py',
        '',
        'nsctl worker gen-config --out generated/payments.json',
        'cd worker && uv run python -m platform_sdk.main --config ../generated/payments.json &',
        '',
        '# Start one, against the namespace your platform just built:',
        `temporal workflow start --type PaymentsWorkflow --task-queue payments-main \\`,
        `  --namespace ws-${slot}-payments-staging --input '\"world\"' \\`,
        '  --api-key "$(vault kv get -field=api_key \\',
        `    secret/namespaces/$WORKSHOP_PARTICIPANT/payments/staging)"`,
      ].join('\n'),
    },
  ],

  checkpoints: [
    {
      id: 'second-namespace',
      title: 'A second spec was provisioned through the platform',
      detail:
        'A namespace with a different spec name in your slot, created without you writing any ' +
        'Terraform or touching the Cloud UI.',
    },
    {
      id: 'workflow-completed',
      title: 'A workflow completed in a provisioned namespace',
      detail: 'The measure of the whole workshop.',
      selfAttested: true,
      gradedBy: 'the Instruqt check, which can see inside your namespace with your own credential',
    },
  ],

  grade: (ctx) => {
    const mine = ctx.mine();
    const specs = new Set(
      mine.map((ns) => ns.tags['spec']).filter((v): v is string => Boolean(v)),
    );

    return [
      ctx.check(
        'second-namespace',
        specs.size >= 2,
        `${specs.size} specs in slot ${ctx.slot}: ${[...specs].join(', ')}`,
        specs.size === 1
          ? `only one spec so far (${[...specs][0]}). Provision another as the developer would`
          : 'no namespaces yet',
      ),
      ctx.attest('workflow-completed'),
    ];
  },
};
