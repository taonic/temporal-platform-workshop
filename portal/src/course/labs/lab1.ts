import { NAMESPACE_MAIN_TF } from '../snippets/namespaceMainTf';
import { NAMESPACE_OUTPUTS_TF } from '../snippets/namespaceOutputsTf';
import type { LabDef } from '../types';

export const lab1: LabDef = {
  number: 1,
  slug: 'spec-to-workflow',
  title: 'Spec to workflow',
  outcome: 'One namespace, provisioned by a Workflow running Terraform in an Activity.',
  writes: 'terraform/namespace/main.tf and outputs.tf',
  feedback: 'cd terraform/namespace && terraform validate',
  minutes: 45,
  intro:
    'Your control plane is running. It knows how to run Terraform, stream its output as ' +
    'heartbeats, and adopt resources a previous attempt orphaned. It has no module to apply. ' +
    'That is your job.',

  steps: ({ stagingSuffix }) => [
    {
      label: 'Write the module',
      command: 'code terraform/namespace/main.tf',
      snippets: ['terraform/namespace/main.tf', 'terraform/namespace/outputs.tf'],
      expect:
        'A comment block describing three resources and two outputs. Write them. The instruction ' +
        'worth re-reading is the one telling you what NOT to write: temporalcloud_apikey exposes ' +
        '.token as a readable attribute, so minting a key there would put a live credential in ' +
        'plaintext into remote state.',
    },
    {
      label: 'Check it without touching the Cloud',
      command: 'cd terraform/namespace && terraform validate',
      expect: 'Success. Terraform can tell you about syntax and types long before the Cloud can.',
    },
    {
      label: 'Ask the four questions',
      command: 'nsctl new',
      expect:
        'A spec in specs/. Two things are NOT in it: your participant id and your slot number. ' +
        'A team asks for a namespace; it does not choose which slot it lands in.',
    },
    {
      label: 'Provision it',
      command: 'nsctl apply -f specs/<name>.yaml',
      expect:
        'Open the Temporal UI, find the workflow, expand the TerraformApply activity and watch the ' +
        'heartbeat details. That is your module\'s own stdout, streamed line by line.',
      grades: 'namespace-exists',
    },
    {
      label: 'Check that the credential rule held',
      command:
        `vault kv get secret/namespaces/$WORKSHOP_PARTICIPANT/<name>/staging\n` +
        `temporal workflow show -w provision-<name> | grep -c "tmprl_" || echo "clean"`,
      expect:
        'A Vault path, and no credential anywhere in the event history. Whatever a workflow ' +
        'returns is readable by anyone who can see it, for the whole retention period.',
      grades: 'provisioned-by-the-platform',
    },
    {
      label: `Confirm the name matches ${stagingSuffix}`,
      expect:
        'Derived from your leased slot, not from your participant id -- Temporal Cloud reserves a ' +
        'namespace name after deletion, so names have to be recyclable.',
    },
  ],

  snippets: () => [
    {
      path: 'terraform/namespace/main.tf',
      lang: 'hcl',
      code: NAMESPACE_MAIN_TF,
      caption: 'Replace the comment block with this. variables.tf and versions.tf are already there.',
    },
    {
      path: 'terraform/namespace/outputs.tf',
      lang: 'hcl',
      code: NAMESPACE_OUTPUTS_TF,
      caption: 'A new file. The reconciler reads both outputs by name.',
    },
  ],

  checkpoints: [
    {
      id: 'namespace-exists',
      title: 'A staging namespace exists',
      detail: 'Named ws-<slot>-<spec>-staging, in your slot.',
    },
    {
      id: 'provisioned-by-the-platform',
      title: 'The platform provisioned it, not a human',
      detail:
        'Tagged provisioner=platform-reconciler. Unlike a tag you set by hand, this one is written ' +
        'by the reconciler itself -- so it is evidence rather than a label.',
    },
    {
      id: 'api-key-auth',
      title: 'API key authentication is enabled',
      detail:
        'Every worker in this workshop authenticates with an API key, and a namespace created ' +
        'without this cannot be switched over afterwards.',
    },
    {
      id: 'retention-set',
      title: 'Retention is set from the spec',
      detail: 'Between 1 and 90 days, and whatever your spec asked for.',
    },
  ],

  grade: (ctx) => {
    const staging = ctx.env('staging');
    if (!staging) {
      return ctx.blockedAll(
        `No namespace tagged participant=${ctx.participant} yet. ` +
          'Run `nsctl apply -f specs/<name>.yaml`, then this turns green on its own.',
      );
    }
    const name = staging.spec.name ?? '(unnamed)';
    const retention = staging.spec.retentionDays;

    return [
      ctx.mk('namespace-exists', 'pass', `${name} (${staging.state ?? 'state unknown'})`),
      ctx.check(
        'provisioned-by-the-platform',
        staging.tags['provisioner'] === 'platform-reconciler',
        'tagged by the reconciler',
        `provisioner tag is ${staging.tags['provisioner'] ?? 'absent'} -- the module must set the full tag set from var.tags`,
      ),
      ctx.check(
        'api-key-auth',
        staging.spec.apiKeyAuth?.enabled === true,
        'enabled',
        'not enabled. Add api_key_auth = true; it cannot be turned on later',
      ),
      ctx.check(
        'retention-set',
        typeof retention === 'number' && retention >= 1 && retention <= 90,
        `${retention} days`,
        `retention is ${retention ?? 'unset'}`,
      ),
    ];
  },
};
