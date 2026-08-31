import { NAMESPACE_MAIN_TF } from '../snippets/namespaceMainTf';
import { NAMESPACE_OUTPUTS_TF } from '../snippets/namespaceOutputsTf';
import { LAB1_SVG } from '../diagrams';
import type { LabDef } from '../types';

export const lab1: LabDef = {
  number: 1,
  slug: 'bootstrap-by-hand',
  title: 'Bootstrap by hand',
  outcome: 'A namespace for the control plane, from a module you wrote and applied by hand.',
  writes: 'terraform/namespace/main.tf and outputs.tf',
  feedback: 'terraform -chdir=terraform/namespace validate',
  minutes: 35,
  intro:
    'You have an identity, and everything from here is named after it -- your namespaces, your ' +
    'Vault paths, your state files. Your control plane knows how to run Terraform, stream its ' +
    'output as heartbeats, and adopt what a failed attempt orphaned. It has nowhere to run and ' +
    'nothing to apply. Both are your job here, and only one of them is a job you will ever do by ' +
    'hand again: something has to create the namespace the namespace-creator runs in.',
  diagram: LAB1_SVG,

  steps: ({ username, cohort, region, accountId }) => [
    {
      label: 'Create the platform\'s service account, and give it to Vault',
      lead:
        'In the Cloud UI, **Identities -> Create Service Account**. Name it ' +
        '`platform-' + username + '`, set **Account Level Role** to **Developer**, and leave ' +
        'Namespace Permissions empty -- it does not need any. Save, and take the offer to create an ' +
        'API key right there; if you skip it, the way back is **API Keys -> Create API ' +
        'Key**, then pick "Service Account" in the *Create an API key for* dropdown and ' +
        '`platform-' + username + '` as the mapped identity. Name the key ' +
        '`platform-' + username + '-key`. **Copy it immediately** -- it is shown once and cannot be ' +
        'read back, and the only recovery is generating another. Then hand it straight to Vault -- ' +
        'the command asks for it and does not echo what you paste, so it stays out of your ' +
        'shell history -- and ask Temporal who it belongs to:',
      command:
        `./scripts/workshop init --api-key      # prompts; your paste is not echoed\n` +
        `\n` +
        `# Ask Temporal who the key in Vault belongs to\n` +
        `source "$(./scripts/workshop env-file)"\n` +
        `temporal cloud whoami \\\n` +
        `  --api-key "$(vault kv get -field=api_key secret/platform/cloud-api-key)"`,
      expect:
        'The first command has more to do than it looks: Vault runs as a pod on your cluster, so ' +
        'if nothing is answering yet it brings Kubernetes, Vault and its Kubernetes auth up ' +
        'first, announcing each step, and seeds the key as the last one. That is why the paste ' +
        'prompt comes before the scrolling rather than after it. ' +
        'The `source` line is what makes `vault kv get` work: without `$VAULT_ADDR` the CLI ' +
        'defaults to `https://127.0.0.1:8200` and fails with "http: server gave HTTP response to ' +
        'HTTPS client", which reads as a TLS problem rather than an unset variable. ' +
        '**Why a service account?** You hold Global Admin, because a student has to be able to ' +
        'see everything. The platform gets the least that works: it creates namespaces, service ' +
        'accounts and tags, and never administers a user -- so Developer is enough, and challenge ' +
        '5 is where you notice nothing was missing.',
    },
    {
      label: 'Write the module',
      command: 'code terraform/namespace/main.tf',
      snippets: ['terraform/namespace/main.tf', 'terraform/namespace/outputs.tf'],
      expect:
        'If this is the first `code` of the day, click the sandbox\'s **Editor** tab once first -- ' +
        '`code` asks an editor window to open a file and cannot open the window itself, and it ' +
        'says so rather than failing silently. `nano` and `vim` are there too.\n\n' +
        'A comment block describing two resources and two outputs. Write them. The instruction ' +
        'worth re-reading is the one telling you what NOT to write: temporalcloud_apikey exposes ' +
        '.token as a readable attribute, so minting a key there would put a live credential in ' +
        'plaintext into remote state.',
    },
    {
      label: 'Check it without touching the Cloud',
      command: 'terraform -chdir=terraform/namespace validate',
      expect:
        'Success. Terraform can tell you about syntax and types long before the Cloud can. ' +
        '`-chdir` rather than `cd`: every command in this challenge runs from the repo root, ' +
        'and this one would otherwise leave your shell two directories down from where the ' +
        'next one expects it.',
    },
    {
      label: 'Now the variables the apply needs',
      lead:
        'The module reads four variables from the environment, and this is the moment they start ' +
        'to matter -- which is why they were not set earlier. The join screen printed this line ' +
        'with every value already in it:',
      command:
        `./scripts/workshop init --username ${username} --cohort ${cohort} \\\n` +
        `  --region ${region} --namespace ws-${username}-control\n` +
        `source "$(./scripts/workshop env-file)"\n` +
        `./scripts/workshop check`,
      expect:
        'It writes the TF_VAR_* variables Terraform reads and the Cloud endpoint for ' + region +
        ', which it derives from the region so the two cannot disagree. `--namespace` names the ' +
        'control plane\'s own namespace -- the one you are about to create, ' +
        '`ws-' + username + '-control`. Note what it does NOT write: the fully qualified name ' +
        'with your account id on the end. It could not honestly write it here, because the ' +
        'namespace does not exist yet and anything it wrote would be a guess. Challenge 2 reads ' +
        'the real name out of Terraform instead, once your apply has made one. `source` loads ' +
        'the variables into the shell ' +
        'you are sitting in; a new terminal needs it again. It does not ask for the key ' +
        '-- that is already in Vault and stays there. Then check reports tools, cluster, Vault, ' +
        'egress and control plane. Read warn and FAIL differently: warn means not built yet -- no ' +
        'platform-worker and no control namespace is exactly right at this point -- and FAIL means ' +
        'broken.',
    },
    {
      label: 'Run your own module by hand, once',
      command:
        `terraform -chdir=terraform/namespace init\n` +
        `./scripts/workshop exec -- terraform -chdir=terraform/namespace apply`,
      expect:
        'A namespace for the control plane itself, made by you, with the module you just wrote. ' +
        'Something has to create the namespace the namespace-creator runs in, and this is the only ' +
        'time you do it. The apply takes no flags because the step above wrote the TF_VAR_* variables ' +
        'Terraform reads from the environment; exec puts the Cloud key into that one command and lets ' +
        'it die there, which is the same lifetime the Terraform activity gives itself. ' +
        'Go and look at what you made -- the **Settings** tab is where the retention and region you ' +
        'passed as variables show up as the namespace\'s own configuration: ' +
        `https://cloud.temporal.io/namespaces/ws-${username}-control.${accountId}`,
    },
    {
      label: 'Confirm what you made',
      command:
        `./scripts/workshop exec -- temporal cloud namespace get \\\n` +
        `  -n ws-${username}-control.${accountId}`,
      expect:
        'One namespace, ACTIVE, in ' + region + ', with the retention you passed and ' +
        '`apiKeyAuth.enabled: true`. That is challenge 1 finished: you wrote the module that ' +
        'creates a namespace, and ran it once by hand to make the one thing that could not create ' +
        'itself -- the namespace the namespace-creator will run in. Challenge 2 starts the control ' +
        'plane on it.',
      grades: 'control-namespace-exists',
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
      id: 'control-namespace-exists',
      title: 'The control plane has a namespace of its own',
      detail: 'Named ws-<username>-control, made by your module, applied by you.',
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
      title: 'Retention is set from a variable',
      detail: 'Between 1 and 90 days, and whatever you passed as TF_VAR_retention_days.',
    },
  ],

  grade: (ctx) => {
    const control = ctx.control();
    if (!control) {
      return ctx.blockedAll(
        `No namespace named ws-${ctx.username}-control yet. Run the apply in the step above, ` +
          'and this turns green on its own.',
      );
    }
    const retention = control.spec.retentionDays;

    return [
      ctx.mk(
        'control-namespace-exists',
        'pass',
        `${control.spec.name} (${control.state ?? 'state unknown'})`,
      ),
      ctx.check(
        'api-key-auth',
        control.spec.apiKeyAuth?.enabled === true,
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
