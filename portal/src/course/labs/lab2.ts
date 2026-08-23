import type { LabDef } from '../types';

export const lab2: LabDef = {
  number: 2,
  slug: 'fanout-and-identity',
  title: 'Fan-out and identity',
  outcome: 'One logical spec, two physical namespaces, two least-privilege identities.',
  writes: 'internal/platform/environment.go',
  feedback: 'go test ./internal/platform/...',
  minutes: 60,
  intro:
    'One spec, two namespaces. The parent workflow already fans out one child per environment and ' +
    'collects the results. The child is missing.',

  steps: () => [
    {
      label: 'Read the workflow id before you write anything',
      command: 'code internal/platform/environment.go',
      expect:
        'EnvironmentWorkflowID is done for you, and it is the keystone. The child\'s workflow id IS ' +
        'the resource identity, so Temporal refuses two executions with the same id -- a single ' +
        'writer per resource, for free. No lock table, no lease, no force-unlock runbook.',
    },
    {
      label: 'Write the child',
      expect:
        'Three activity calls and one decision. The decision is what you return: MintKeyResult has ' +
        'a path and an id and no token, because whatever you return is written to the event history.',
    },
    {
      label: 'Make the tests pass before touching the Cloud',
      command: 'go test ./internal/platform/...',
      expect:
        'TestProvisionWorkflowFansOutPerEnvironment asserts the Vault path comes back. ' +
        'TestProvisionWorkflowReportsPartialFailure asserts one broken environment does not fail the other.',
    },
    {
      label: 'Provision both environments',
      command: 'nsctl apply -f specs/<name>.yaml',
      expect: 'Two namespaces, two service accounts, two credentials in Vault.',
      grades: 'both-environments',
    },
    {
      label: 'Ask the state service for a lock',
      command:
        'curl -s -X LOCK -u "$WORKSHOP_PARTICIPANT:$STATE_TOKEN" \\\n' +
        '  "$STATE_SERVICE_URL/state/$WORKSHOP_PARTICIPANT/<name>/staging"',
      expect: '405, and an explanation of why locking would protect against something that cannot happen.',
    },
    {
      label: 'Break one environment on purpose',
      expect:
        'Set an impossible region for prod and re-apply. Staging succeeds, prod fails, and you get ' +
        'both results. A platform that collapses that into one error is lying to whoever is on call.',
    },
  ],

  checkpoints: [
    {
      id: 'both-environments',
      title: 'Both environments exist',
      detail: 'staging and prod, from one spec, fanned out by the parent workflow.',
    },
    {
      id: 'scoped-identity',
      title: 'Each namespace has a namespace-scoped worker identity',
      detail:
        'Named <namespace>-worker, with namespace_scoped_access rather than account_access. A worker ' +
        'polls a task queue and completes tasks; it needs no account-level access at all.',
    },
    {
      id: 'write-not-admin',
      title: 'The worker identity has write, not admin',
      detail: 'Least privilege that still works. Admin on the namespace would let a worker delete it.',
    },
  ],

  grade: (ctx) => {
    const staging = ctx.env('staging');
    const prod = ctx.env('prod');
    if (!staging) {
      return ctx.blockedAll('No namespaces yet -- finish challenge 1 first.');
    }

    const sas = ctx.serviceAccounts();
    const found = (nsName: string) =>
      sas.find((sa) => sa.spec.name === `${nsName}-worker`);

    const stagingName = staging.spec.name ?? '';
    const prodName = prod?.spec.name ?? '';
    const stagingSa = stagingName ? found(stagingName) : undefined;
    const prodSa = prodName ? found(prodName) : undefined;

    const scoped = (sa: typeof stagingSa) => Boolean(sa?.spec.access?.namespaceScopedAccess?.namespaceId);
    const permission = stagingSa?.spec.access?.namespaceScopedAccess?.permission?.toLowerCase();

    return [
      ctx.check(
        'both-environments',
        Boolean(staging && prod),
        `${stagingName} and ${prodName}`,
        prod
          ? 'only one environment found'
          : 'prod is missing. One spec should fan out to both environments -- check the parent is starting a child per env',
      ),
      ctx.check(
        'scoped-identity',
        scoped(stagingSa) && (!prod || scoped(prodSa)),
        'namespace-scoped, both environments',
        stagingSa
          ? `${stagingName}-worker exists but is not namespace-scoped. namespace_scoped_access and account_access are mutually exclusive`
          : `no service account named ${stagingName}-worker`,
      ),
      ctx.check(
        'write-not-admin',
        permission === 'write',
        `permission = ${permission}`,
        `permission is ${permission ?? 'unknown'}; the spec asks for write`,
      ),
    ];
  },
};
