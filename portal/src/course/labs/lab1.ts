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
    'You have an identity. Everything from here is named after it -- your namespaces, your Vault ' +
    'paths, your state files -- which is why you chose it rather than being handed a number. ' +
    'Your control plane is built and has nowhere to run: it knows how to run Terraform, stream its ' +
    'output as heartbeats, and adopt resources a previous attempt orphaned, but it needs a ' +
    'namespace of its own and it has no module to apply. Both of those are your job, and only ' +
    'one of them is a job you will ever do by hand again.',

  steps: ({ stagingSuffix, username }) => [
    {
      label: 'Point this machine at the identity you just chose',
      command:
        `./scripts/workshop-creds init --username ${username} --state-token <from the portal>\n` +
        `source "$(./scripts/workshop-creds env-file)"`,
      expect:
        'The join screen printed this line with both values already in it -- paste that rather than ' +
        'retyping. It writes the TF_VAR_* variables Terraform reads, your Vault and state-service ' +
        'addresses, and the token the state backend authenticates with. Note what is NOT in it: the ' +
        'Cloud API key. That lives in Vault, and nothing after this takes a key as input.',
    },
    {
      label: 'Give the platform its own identity -- Cloud UI, Settings -> Service Accounts',
      expect:
        'Separate from yours, and that separation is the lesson. You hold Global Admin, because a ' +
        'student has to see everything. Create a service account named platform-' + username +
        ' with the account role DEVELOPER, then generate an API key for it. Developer, not Admin: ' +
        'generate an API key for it. Developer, not Admin: the platform creates namespaces, service ' +
        'the platform creates namespaces, service accounts and tags, and never administers a user -- ' +
        'challenge 5 is where you notice Developer was enough. The key list is account-wide, so name ' +
        'yours so you can find it among two dozen, and do NOT delete a key that is not yours. The key ' +
        'is shown ONCE and cannot be read back; copy it now. In the Instruqt sandbox this already ' +
        'exists and its key is already in Vault, so read this and move on.',
    },
    {
      label: 'Put the key where the platform reads it, and check the environment',
      command:
        `make check\n` +
        `# only if "platform cloud api key present" is missing -- your own machine, first run:\n` +
        `TEMPORAL_CLOUD_API_KEY=<the key you just created> make base-up\n` +
        `unset TEMPORAL_CLOUD_API_KEY\n` +
        `make check`,
      expect:
        'Tools, cluster, Vault, egress, control plane. Read warn and FAIL differently: warn means not ' +
        'built yet -- no platform-worker and no control namespace is exactly right before you start -- ' +
        'and FAIL means broken. That one command is the only time the key is ever a variable: it goes ' +
        'into Vault and the variable is unset, so history does not have it and no later command takes ' +
        'a key as input. If anything asks you to paste one after this, that is a fault, not a step.',
    },
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
      label: 'Run your own module by hand, once',
      command:
        `terraform -chdir=terraform/namespace init\n` +
        `./scripts/workshop-creds exec -- terraform -chdir=terraform/namespace apply`,
      expect:
        'A namespace for the control plane itself, made by you, with the module you just wrote. ' +
        'Something has to create the namespace the namespace-creator runs in, and this is the only ' +
        'time you do it. The apply takes no flags because step 1 already wrote the TF_VAR_* variables ' +
        'Terraform reads from the environment; exec puts the Cloud key into that one command and lets ' +
        'it die there, which is the same lifetime the Terraform activity gives itself. Note the tag: ' +
        'provisioner=human-bootstrap. Every namespace after this one says platform-reconciler, and ' +
        'the difference is the whole point.',
    },
    {
      label: 'Point the control plane at it and start it',
      command:
        `./scripts/workshop-creds control\n` +
        `source "$(./scripts/workshop-creds env-file)"\n` +
        `make platform-up`,
      expect:
        'control reads namespace_id straight out of the Terraform state, so you never ' +
        'copy the account suffix by hand. Then your module is compiled into the worker image -- ' +
        'terraform/embed.go embeds terraform/namespace/*.tf -- and that build is what carries what ' +
        'you wrote into the pod. It is also why editing any of it later needs make reload rather ' +
        'than a restart: the control plane never reads the file, only the copy inside its own ' +
        'binary. make logs should show it listening on the platform task queue.',
    },
    {
      label: 'Ask the four questions',
      command: 'nsctl new',
      expect:
        'A spec in specs/. One thing is NOT in it: your username. A team asks for a namespace; ' +
        'it does not decide where the platform puts it, or what the platform calls it.',
    },
    {
      label: 'Provision it',
      command: 'nsctl apply -f specs/<name>.yaml',
      expect:
        'Open cloud.temporal.io, find the workflow in your control-plane namespace, expand the ' +
        'TerraformApply activity and watch the heartbeat details. That is your module\'s own ' +
        'stdout, streamed line by line. `make logs` is the other half of the picture.',
      grades: 'namespace-exists',
    },
    {
      label: 'Check that the credential rule held',
      command:
        `vault kv get secret/namespaces/${username}/<name>/staging\n` +
        `./scripts/workshop-creds exec -- temporal workflow show -w provision-<name> \\\n` +
        `  | grep -c "tmprl_" || echo "clean"`,
      expect:
        'A Vault path, and no credential anywhere in the event history. Whatever a workflow ' +
        'returns is readable by anyone who can see it, for the whole retention period.',
      grades: 'provisioned-by-the-platform',
    },
    {
      label: `Confirm the name matches ${stagingSuffix}`,
      expect:
        'Derived from the username you chose, not from anything the spec says. What you asked for ' +
        'and what the platform decided are different things, and this is where you can see the seam.',
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
      detail: 'Named ws-<username>-<spec>-staging.',
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
        `No namespace tagged username=${ctx.username} yet. ` +
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
