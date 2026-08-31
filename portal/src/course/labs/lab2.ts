import { REGISTER_GO } from '../snippets/registerGo';
import {
  ENVIRONMENT_RETURN,
  ENVIRONMENT_WORKFLOW,
  REGISTER_CHALLENGE_2,
  SPEC_EXAMPLE,
  tpctlNewOutput,
} from '../snippets/excerpts';
import { LAB2_SVG } from '../diagrams';
import { DEFAULT_SPEC } from '../spec-name';
import type { LabDef } from '../types';

// The spec name this lab tells you to create. Module scope because both `steps`
// and `snippets` name it, and two copies of a literal is one copy too many.
const SPEC = DEFAULT_SPEC;

export const lab2: LabDef = {
  number: 2,
  slug: 'turn-on-the-provisioner',
  title: 'Turn on the provisioner',
  outcome: 'A namespace and its worker identity, provisioned by a control plane you switched on, from a spec you wrote.',
  writes: 'internal/platform/register.go',
  feedback: 'go build ./...',
  minutes: 70,
  intro:
    'Challenge 1 left you a Temporal namespace and nothing running in it. The control plane is written -- ' +
    'the workflows, the Terraform activity, the mint-key activity, all of it -- and none of it ' +
    'runs, because a worker only knows what it has been told about. Your job here is to read what ' +
    'is there and turn it on, a piece at a time, and to write the thing that gives it something to ' +
    'do: a spec.',
  diagram: LAB2_SVG,

  steps: ({ username, accountId }) => {
    // The spec name the lab tells you to create. Passed to `tpctl new --name`
    // rather than left to the wizard, so every later step can name the file,
    // the Vault path and the state directory instead of printing <name> and
    // making you substitute it four times.
    const spec = SPEC;
    // And therefore the physical name, spelled out rather than taken from
    // ctx.stagingSuffix.
    //
    // That context value is a PATTERN: it renders `ws-<you>-<spec>-staging` until
    // the reconciler has written the spec name into the namespace tags for the
    // portal to read back. Which is never, on this page -- a student reads lab 2
    // before they have provisioned anything, so the link below would have been a
    // URL with a literal `<spec>` in it. The pattern is right for a lab where the
    // student picks the name; here the lab picks it.
    const ns = `ws-${username}-${spec}-staging`;
    return [
    {
      label: 'Point the platform at the namespace you just made',
      lead:
        'You now have a control plane namespace ready in Temporal Cloud, made by your own module ' +
        'in challenge 1. That namespace is the thing that makes the rest of this automation ' +
        'possible: it is where the control plane\'s own workflows will run. So bring the platform ' +
        'up on Kubernetes and point it at that namespace:',
      command:
        './scripts/workshop platform-up \\\n' +
        '  --control-namespace "$(terraform -chdir=terraform/namespace \\\n' +
        '                          output -raw namespace_id)"',
      expect:
        'It announces each step before taking it and waits for a keypress, so read as you go -- ' +
        'nothing here should be a black box you ran once. (`--yes` skips the waiting on later ' +
        'runs, and a non-interactive shell never waits at all.) What it does, in order:',
      bullets: [
        '**Builds the worker image.** Your Terraform module is compiled *into* it -- ' +
          '`terraform/embed.go` embeds `terraform/namespace/*.tf` -- so the module you wrote in ' +
          'challenge 1 travels inside the binary. That is why editing it later needs ' +
          '`workshop reload` rather than a restart: the pod never reads the file.',
        '**Makes sure there is a cluster to deploy into,** creating a k3d one if you have none ' +
          'and starting it if it is merely stopped. It also refuses to continue if kubectl is ' +
          'pointing somewhere unexpected -- a control plane and a Vault full of credentials do ' +
          'not belong in whatever cluster you were last working in.',
        '**Loads that image into the cluster,** because k3d and k3s each run their own ' +
          'containerd and cannot see images built by your local Docker.',
        '**Makes sure Vault is running** and that Kubernetes auth is configured, bringing both ' +
          'up if the cluster does not have them. Nothing in that step is secret, so it is safe to ' +
          'repeat. The one thing it will not do is take your Cloud API key: that was pasted once ' +
          'into Vault in challenge 1 and is read from there forever after.',
        '**Points the worker at your control namespace.** The flag is spelled out above so you ' +
          'can see both what is being passed and where it comes from: Terraform, which created ' +
          'the namespace and is therefore the only thing that knows its real name -- including ' +
          'the account id on the end. You never type that name, so it cannot be stale or ' +
          'mistyped. Omit the flag entirely and `platform-up` runs that same `terraform output` ' +
          'for you; it is written out here so the wiring is visible once.',
        '**Writes the `platform-env` ConfigMap** -- the namespace, the Cloud address, your ' +
          'username and cohort. Its keys are the environment variable names the worker reads, so ' +
          'there is no translation table to keep in sync.',
        '**Creates a ServiceAccount and a PersistentVolumeClaim.** The ServiceAccount is how the ' +
          'pod authenticates to Vault; it carries no credential of its own, and the Cloud API key ' +
          'appears nowhere in the manifest. The volume is where Terraform state will land.',
        '**Deploys the worker and waits for the rollout** to finish, so the command returning ' +
          'means the thing is actually up.',
      ],
      closing:
        'What comes up is a worker, running, registered for nothing. `workshop logs` shows it ' +
        'polling the platform task queue and that is all it can do -- every workflow and every ' +
        'activity in `Register` is commented out. **The control plane\'s first customer is ' +
        'itself**: it is now running on the namespace it will shortly learn to create.',
    },
    {
      label: 'Look at what you just built',
      command: 'k9s -n platform',
      expect:
        'Two pods: the control plane worker, and Vault beside it. Spend two minutes here -- ' +
        'everything after this is something you did to a cluster you have actually seen, rather ' +
        'than to an abstraction.\n\n' +
        'Press `l` on the worker for its logs -- the same stream `workshop logs` prints -- and ' +
        '`d` to describe it. In the describe output, find the ServiceAccount it runs as and the ' +
        'absence of any credential: the pod authenticates to Vault as itself, so the Cloud API ' +
        'key appears nowhere in the manifest. Then `:configmaps` and open `platform-env`, which ' +
        'is the config the script wrote a moment ago. `?` is help, `:q` quits.',
      closing:
        'It is not on the critical path -- every command in this workshop works without it -- but ' +
        'a platform you cannot see is a platform you cannot debug, and this is the cheapest ' +
        'possible way to see it.',
    },
    {
      label: 'What a spec is, and why the platform wants one',
      lead:
        'Before you turn anything on, understand what it consumes. A **spec** is one team\'s ' +
        'request for a Temporal namespace, written down and committed:',
      snippets: ['spec-example'],
      expect:
        'Four things are true about that file, and each one is a reason it exists rather than a ' +
        'ticket, a Slack message, or a Terraform module the team copied from another team.\n\n' +
        '**It is a request, not an implementation.** Nothing in it says how a namespace gets ' +
        'made, which provider version, or where state lives. The team asks; the platform decides. ' +
        'Notice what is *absent*: no username, no account, no physical name, no region strategy. ' +
        'Those are platform decisions, and keeping them out of the file is the seam this whole ' +
        'workshop is about.\n\n' +
        '**It is reviewable.** `owner` is who gets paged, and the retention above is a number ' +
        'somebody is allowed to argue with. Both are a diff now, rather than a click nobody ' +
        'saw.\n\n' +
        '**It is policy-shaped.** Nothing here stops a team asking for 90 days. The moment a ' +
        'platform caps that -- by environment, by tier, by who is asking -- the same file stops ' +
        'being configuration and starts being policy, and no team has to be told twice.\n\n' +
        '**It is the input to a control loop.** The platform starts one child workflow per ' +
        'environment listed, so asking for a second namespace is a one-line diff rather than a ' +
        'different code path. In ' +
        'challenge 3 the same file becomes the desired state something converges on, and the ' +
        'difference between those two sentences is the difference between a script and a platform.',
    },
    {
      label: 'Dog-food it: provisioning is itself a workflow',
      lead:
        'A platform could shell out to `terraform apply` from a script and call it done. This ' +
        'one does not. Provisioning a namespace **is a Temporal workflow**, run by the worker you ' +
        'started two steps ago -- so the tool you are building a platform for is the tool the ' +
        'platform is built out of.\n\n' +
        'That is not decoration. An apply is long, it fails halfway, it has to be retried without ' +
        'being repeated, and somebody will want to know what happened three days later. Durable, ' +
        'retryable, auditable, able to wait on a human: those are the properties an apply needs ' +
        'and the properties a workflow already has.\n\n' +
        'None of it runs until the worker has been told it exists. Every workflow and every ' +
        'activity reaches the worker through exactly one function:',
      command: 'code internal/platform/register.go',
      expect:
        'One function, and everything in it commented out except a workflow that is there only ' +
        'to keep the file compiling. This is the only file you edit in this challenge and the ' +
        'next -- the workflows themselves are already written, in ' +
        '`internal/platform/workflow`, and the activities beside them in ' +
        '`internal/platform/activity`.\n\n' +
        'Registration is not bookkeeping. It is the boundary between code that **exists** and ' +
        'code that can be **scheduled**, and it fails late: an unregistered workflow says nothing ' +
        'at startup and then fails the moment something tries to start it, with ' +
        '`unable to find workflowType`. That error is worth recognising on sight.',
    },
    {
      label: 'Read the child before you turn it on',
      lead:
        'The parent already fans out one child per environment and collects the results. This is ' +
        'the child, in full -- about forty lines, and you are not going to write any of them. ' +
        'Read it before you switch it on:',
      command: 'code internal/platform/workflow/environment.go',
      snippets: ['environment-workflow'],
      expect:
        'Three activity calls and one decision. Two things are worth stopping on.\n\n' +
        '**The workflow id IS the resource identity.** `EnvironmentWorkflowID` returns ' +
        '`ns-' + spec + '-staging` here, and Temporal refuses to run two executions with the same ' +
        'id -- so a ' +
        'single writer per resource comes for free. No lock table, no lease, no ' +
        '`terraform force-unlock` runbook, because a second concurrent writer cannot come into ' +
        'existence. Look at the backend config afterwards: nothing in it configures a lock ' +
        'address, and now you know why.\n\n' +
        '**The activity options are not boilerplate.** A cold provider download plus a namespace ' +
        'create is minutes, so `StartToCloseTimeout` is 30 minutes -- but that only ever detects ' +
        'a *slow* apply. What detects a **dead worker** is `HeartbeatTimeout`, and it is 30 ' +
        'seconds: the activity beats every 5s, the worker sends at most every 10s, so three ' +
        'missed beats and the apply is rescheduled somewhere alive.\n\n' +
        'That number is only safe because of a setting you cannot see from here. The SDK ' +
        'throttles heartbeats to 80% of the timeout unless told otherwise -- which would make 30 ' +
        'seconds mean *one* send, and a single dropped request would kill a healthy apply and ' +
        'restart terraform while the first one was still exiting. `MaxHeartbeatThrottleInterval` ' +
        'in the worker options is what decouples how fast you detect death from how much slack ' +
        'you have.',
    },
    {
      label: 'Now look again at the last ten lines',
      lead:
        'You have just read them in context; here they are on their own, because this is the ' +
        'decision the whole challenge is built around:',
      snippets: ['environment-return'],
      expect:
        '`MintKeyResult` has a path and an id and **no token**. That is not an oversight. ' +
        'Whatever a workflow returns is written to the event history, where it is readable by ' +
        'anyone who can see the workflow, for the whole retention period -- a credential in a ' +
        'return value is a credential in an audit log you cannot redact.\n\n' +
        'The error path is worth a second read too. If the apply succeeds and the mint fails, ' +
        'the namespace exists and is usable; only the credential is missing. It returns the error ' +
        'so the caller retries, but populates `NamespaceID` and `ServiceAccountID` on the way out ' +
        'anyway, so the next attempt adopts the namespace rather than trying to create it again.',
    },
    {
      label: 'Turn it on, and ship it',
      lead: 'In `internal/platform/register.go`, uncomment the challenge 2 block:',
      snippets: ['register-challenge-2'],
      command: 'go build ./... && ./scripts/workshop reload',
      expect:
        'Four lines. Two workflows and two activity receivers -- `Terraform`, which creates the ' +
        'namespace and its identity, and `Key`, which mints the credential. Leave the challenge 3 ' +
        'block commented; you turn that on next.\n\n' +
        '`reload` builds the image itself, so the `go build` in front of it is not doing the ' +
        'build -- it is a two-second gate on a forty-second operation. Delete one `/` too many ' +
        'and you find out now, from a compiler pointing at the line, instead of four minutes into ' +
        'a Docker build with the error somewhere in the output. That is the `&&` earning its ' +
        'keep.\n\n' +
        'The reload itself is not optional. The running pod still has the old binary with nothing ' +
        'registered, and a restart would only start that same binary again -- the module and your ' +
        'Go are compiled *into* the image, so shipping a change means rebuilding it. Skip this ' +
        'and the next step fails with `unable to find workflowType: ProvisionWorkflow`, which is ' +
        'at least honest about what happened.',
    },
    {
      label: 'Now write the request',
      lead:
        'The control plane is running and it knows how to provision. It has nothing to ' +
        'provision. Put your hat on as the team asking:',
      command: `tpctl new --name ${spec} --environments staging`,
      snippets: ['tpctl-new-output'],
      expect:
        'It asks three questions, not four -- the name came from the flag, and a value you have ' +
        'already given is an answer rather than a question. Every prompt has a flag like that, ' +
        'which is what makes the same tool usable in a demo and in CI.\n\n' +
        'It wrote **one** environment. A namespace is a finite account resource, so the default ' +
        'is the least that works; `--environments staging,prod` asks for more, and challenge 3 ' +
        'adds one and watches the loop converge on it.\n\n' +
        'Still nothing provisioned. You have written a request -- but this time something is ' +
        'running that can answer it.',
    },
    {
      label: 'Provision it',
      command: `tpctl apply -f specs/${spec}.yaml`,
      expect:
        'The command blocks, and it will sit there for a few minutes. That wait is the whole ' +
        'architecture doing its job, so watch it rather than staring at it. What is happening:',
      bullets: [
        '`tpctl` started a workflow called `provision-' + spec + '` on your control namespace and ' +
          'is now waiting on the result. It is a client -- the work is not happening in your ' +
          'terminal, and killing the command would not stop it.',
        'The parent checks the account quota once per environment, **before** starting any work. ' +
          'A quota failure that arrives from inside Terraform reads as a broken module and lands ' +
          'on whoever applies next, so the platform asks first.',
        'It then starts one child workflow per environment. Your spec lists one, so there is one ' +
          'child: `ns-' + spec + '-staging`. That id is the one you read about -- the resource ' +
          'identity and the lock in a single string. Add an environment and a second child ' +
          'appears beside it, which is the fan-out you will see in challenge 3.',
        'Each child runs Terraform in an activity. The first apply is slow because the provider ' +
          'is downloaded cold; every line of Terraform output is reported as an activity ' +
          'heartbeat, which is what tells Temporal the worker is alive rather than merely slow.',
        'Each child then mints an API key through the Cloud Ops API -- not through Terraform -- ' +
          'and writes it straight to Vault, returning the path.',
      ],
      closing:
        'Two places to watch it happen, and they show different things. In `k9s`, select the ' +
        'worker pod and press `l` to tail its logs: that is the Terraform output streaming ' +
        'through the activity, and the only place you can see the apply itself. In the Cloud UI, ' +
        'open the workflow to see the shape rather than the noise -- the parent, its two ' +
        'children, and which activity each is sitting in:\n\n' +
        `https://cloud.temporal.io/namespaces/ws-${username}-control.${accountId}/workflows\n\n` +
        `Open \`provision-${spec}\` from that list. When the command returns you get a table: the ` +
        'namespace, its service account, and a **Vault path** in the credential column rather ' +
        'than a key. That column is the point -- the token never entered the event history you ' +
        'were just looking at.',
      grades: 'environment-provisioned',
    },
    {
      label: 'Open the namespace you just made',
      lead:
        'Not the control plane this time -- the namespace your spec asked for, made by your ' +
        'platform rather than by you:',
      command: `https://cloud.temporal.io/namespaces/${ns}.${accountId}`,
      expect:
        `Its name is **${ns}**, and nothing in your spec said that. You asked for ` +
        '`orders`; the platform decided where it goes and what to call it, from the username you ' +
        'chose at the join screen. That seam -- what you asked for versus what the platform ' +
        'decided -- is the one this whole workshop is about, and this is the first place you can ' +
        'see it rather than read about it.\n\n' +
        'Open **Settings** and check three things against the spec you wrote:',
      bullets: [
        '**Retention** matches your `retentionDays`. It came out of the file, through a Terraform ' +
          'variable, into a real namespace.',
        '**Region** matches your `region`, for the same reason.',
        '**API key authentication** is enabled -- which the spec never mentions. That one is a ' +
          'platform decision baked into the module, and it cannot be turned on afterwards, which ' +
          'is exactly why it is not left to whoever writes the spec.',
      ],
      closing:
        'Then look at **Identities**: `' + ns + '-worker`, scoped to this namespace ' +
        'alone. Nothing in the spec asked for that either.',
    },
    {
      label: 'Check that the credential rule held',
      command:
        `vault kv get secret/namespaces/${username}/${spec}/staging\n` +
        `./scripts/workshop exec -- temporal workflow show -w provision-${spec} \\\n` +
        `  | grep -c "tmprl_" || echo "clean"`,
      expect:
        'A Vault path, and no credential anywhere in the event history. You read the reason ' +
        'before you ran it; this is the proof.',
    },
    {
      label: 'Break it on purpose',
      expect:
        'Set an impossible region in the spec and re-apply. The child fails, the parent collects ' +
        'that failure as a per-environment result rather than one flat error, and `tpctl` prints ' +
        'the reason next to the environment it belongs to.\n\n' +
        'That shape matters more than it looks with a single environment. Add `prod` and break ' +
        'only it: staging succeeds, prod fails, and you get **both** answers. A platform that ' +
        'collapses that into one error is lying to whoever is on call -- and `EnvStatus` exists ' +
        'so it cannot. Put the region back before moving on.',
    },
    ];
  },

  snippets: ({ username }) => [
    { id: 'spec-example', lang: 'yaml', code: SPEC_EXAMPLE, caption: `specs/${SPEC}.yaml -- trimmed to the fields worth arguing about.` },
    {
      id: 'tpctl-new-output',
      lang: 'bash',
      code: tpctlNewOutput(username),
      caption: 'What it prints. The physical namespace name is the platform\'s decision, not yours.',
    },
    {
      id: 'environment-workflow',
      lang: 'go',
      code: ENVIRONMENT_WORKFLOW,
      caption: 'internal/platform/workflow/environment.go -- already written. Read it, do not change it.',
    },
    {
      id: 'environment-return',
      lang: 'go',
      code: ENVIRONMENT_RETURN,
      caption: 'internal/platform/workflow/environment.go -- the end of EnvironmentWorkflow.',
    },
    {
      id: 'register-challenge-2',
      lang: 'go',
      code: REGISTER_CHALLENGE_2,
      caption: 'internal/platform/register.go -- remove the // from these four lines.',
    },
    {
      // Emitted, never shown. `make solve` writes this so `verify` compiles the
      // file a student ends up with; the page already shows the four lines to
      // uncomment, and printing the whole thing underneath only invites pasting
      // over the edit they were asked to make.
      path: 'internal/platform/register.go',
      hidden: true,
      lang: 'go',
      code: REGISTER_GO,
    },
  ],

  checkpoints: [
    {
      id: 'environment-provisioned',
      title: 'The environment in your spec exists',
      detail:
        'One spec, one child workflow, one namespace. The parent starts a child per environment ' +
        'listed, so asking for a second is a one-line diff rather than a different code path.',
    },
  ],

  grade: (ctx) => {
    // Either environment counts. The spec defaults to staging, but a student who
    // asked for prod instead has done the challenge, and a grader that insists on
    // one particular name would fail them for reading the flag.
    const ns = ctx.env('staging') ?? ctx.env('prod');
    if (!ns) {
      return ctx.blockedAll(
        'No provisioned namespace yet. Uncomment the challenge 2 block in register.go, run ' +
          '`go build ./... && workshop reload`, then `tpctl apply` -- these turn green on their own.',
      );
    }

    const nsName = ns.spec.name ?? '';

    return [
      ctx.check(
        'environment-provisioned',
        Boolean(nsName),
        nsName,
        'no namespace found for your spec yet',
      ),
    ];
  },
};
