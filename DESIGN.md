# Temporal Platform Workshop — Design

A five-challenge, self-paced Instruqt track in which platform engineers build a
control plane for Temporal Cloud: a CLI that generates specs, a reconciler that
interprets them as Temporal workflows, and a paved road that ends with a
developer's worker running on Kubernetes.

Settled across six rounds of design review. No code exists yet. Nothing below is
a placeholder — where a decision was contested, the reasoning is recorded with it.

---

## Thesis

> Temporal makes durable execution possible; the platform path makes it repeatable.
> — *OpenAI @ Replay 2026, From Adoption to Production at Scale*

Most Temporal training teaches you to write a workflow. This teaches you to build
the platform underneath it. The workshop's north star is the talk's own headline
metric: **time-to-first-workflow, from one-to-two weeks down to minutes.** The
final challenge does not measure it with a stopwatch; it demonstrates it, by
taking a decorated workflow to a running worker and a completed execution in one
command.

The stopwatch was a fifth challenge and is now gone: it measured the metric by
having a student use the platform as a customer, and everything it measured is
already visible in challenge 4, where the paved road produces a running worker and
then proves it by executing a workflow through it. A challenge that re-runs the
previous one with a timer on it is a demonstration, not a lab.

The architecture takes one deliberate position against its own source material.
OpenAI replaced Terraform with a Kubernetes operator because Terraform was making
them slow. We keep Terraform as the execution engine inside a single activity, and
build the control loop as a **Temporal entity workflow instead of a k8s
controller** — because a workflow is a strictly better operator: durable by
construction, retryable, auditable, and able to wait on a human. That claim is the
subject of a ten-minute discussion at the end of challenge 4, not a lab.

---

## Audience and format

| | |
|---|---|
| Audience | Platform engineers who will build this at their own company |
| Format | Self-paced-capable Instruqt track; instructor-led guide layered on top |
| Shape | 4 challenges, ~3.5 hours |
| Cohort | 15 students |
| Prior art | `temporal-cloud-training-portal` (sandbox, grading, invite lifecycle), `temporal-terraform-demo` (Terraform-in-activity) |

Self-paced is the harder constraint. Satisfy it and instructor-led is a delivery
guide rather than a rebuild. It also means **no cross-student dependencies** — the
portal's Nexus lab, which depended on the instructor's own endpoint existing, has
no equivalent here.

---

## Architecture

Three planes, mirroring the talk's own architecture slide.

```
  PRODUCT SURFACE            PLATFORM CONTROL PLANE            TEMPORAL CLOUD
  (Python)                   (Go)

  decorated workflow         tpctl  ── interactive wizard      namespace (staging)
    declares queue + ns        │                               namespace (prod)
        │                      ├─ writes specs/*.yaml          namespace-scoped SA
        ▼                      │                               API key
  gen-config ──────────────►   ├─ reconciler workflow          namespace tags
    worker config              │    entity per logical ns
        │                      │    child per environment
        ▼                      │
  managed worker  ─────────►   ├─ terraform activity ─────────────────┘
    validates config           │     (ports temporal-terraform-demo)
    on k3s                     │
                               └─ mint-key activity ──► Vault

  SUPPORTING SERVICES
    Authentik       — SAML IdP on Fly. Usernames chosen at join. No mail anywhere
    (Terraform state is a local file. There is no state service.)
```

### The language seam

Go for the platform, Python for the product. This is the OpenAI split exactly
(Go tooling, Python workers), and it puts the seam on the boundary the workshop is
teaching rather than in an arbitrary place.

| Side | Language | Contents |
|---|---|---|
| Platform | Go | `tpctl` CLI, reconciler workflows, Terraform activities, mint-key activity |
| Product | Python | Decorator machinery, `gen-config`, the managed worker deployed to k3s |

Two consequences worth stating. First, the Go reconciler means
`temporal-terraform-demo`'s `tfexec` / `tfworkspace` / `tfactivity` / `heartbeat`
packages and its `AttemptImport` idempotency trick **port nearly verbatim** — the
largest single build saving in the design. Second, students read both languages,
divided by role, so a platform engineer experiences their own platform from the
developer's side.

### Two workers

| Worker | Language | Hosts | Runs on |
|---|---|---|---|
| Platform worker | Go | Reconciler workflows, Terraform + mint-key activities | k3s in the sandbox, against the Cloud control-plane namespace the student's own Terraform provisioned in challenge 1 |
| Managed worker | Python | The developer's decorated workflows | k3s in the sandbox, deployed by the platform in challenge 4 |

Only the managed worker moves to Kubernetes. A platform's control plane is central
infrastructure that already exists; the managed worker is the per-team artifact the
platform produces. So challenge 4 reads as *"your platform deployed someone else's
worker"* — the paved road working — rather than as a redeployment of your own.

The control plane running on a namespace it provisioned itself is the bootstrap
punchline: **the control plane's first customer is itself.**

---

## Load-bearing design rules

Ten rules carry the design. Each one is a lesson as much as an implementation
choice — except the last three, which are constraints on how the other seven get
built, taught and maintained.

### 1. Workflow ID is the resource identity, so Temporal is the lock

One entity workflow per logical namespace, keyed on its name and started with
`signal-with-start`; one child workflow per physical namespace. Temporal's own
workflow-ID uniqueness constraint gives single-writer-per-resource for free.

Therefore: **no DynamoDB lock table, no lease, and no `terraform force-unlock`
runbook.** State conflicts are prevented upstream of the backend, by the workflow
id, rather than arbitrated by it.

Leave a comment in the backend config saying why. A student who notices the missing
lock and asks "isn't that dangerous?" is one question from the best insight in the
workshop. State conflicts are structurally impossible here rather than handled.

### 2. Credentials never pass through Terraform

`temporalcloud_apikey` exposes `.token` as a readable attribute, and
`sensitive = true` masks CLI output without encrypting state. Minting keys in
Terraform would put every student's live credential in plaintext on a Fly volume.

So keys are **not** a Terraform resource. A separate activity calls the Cloud Ops
API directly, writes to Vault, and returns **a Vault path and a key ID — never the
token.** One rule, three problems solved: nothing sensitive in state, nothing
sensitive in workflow event history, and rotation stops being state surgery.

It also draws the Terraform-vs-API boundary where a real platform team draws it:
Terraform is the wrong tool for something you intend to rotate, because
`terraform destroy` would revoke your workers' auth.

### 3. A Developer-role service account is exactly sufficient

Verified against the permissions reference: Developer can create namespaces and
receives Namespace Admin on the ones it creates. Namespace Admin is precisely what
is required to manage namespace-scoped service accounts, mint their API keys, and
set namespace tags.

The platform therefore needs **no account-admin power**. This is also why
`metrics_endpoint` correctly fell out of the resource set — it requires an
account-scoped `metricsread` service account.

### 4. Config is generated from code, so it cannot drift

The decorated workflow is the source of truth. `@workflow.defn` is extended so a
workflow declares its own task queue and namespace; `gen-config` imports the
modules and emits the worker config from the live registry. The Python side owns
this because that is where the decorators are; `tpctl worker gen-config` is a
**façade that shells out**, which is both better UX and a real lesson — a
platform CLI is a user interface, not a place where logic lives.

### 5. The worker refuses to start on a config mismatch

On boot the managed worker compares its generated config against the workflows it
actually registered, and **exits non-zero naming the discrepancy.** Not a warning;
a warning in a pod's logs is a warning nobody reads.

This is the direct fix for the failure the talk names: *"always register that
workflow at bootstrap — often times people miss that."* A student who forgets an
import gets a clear message from their own platform instead of a workflow that
silently never runs.

### 6. Intent arrives by signal; reality arrives by timer

Both transports, deliberately. A **git post-commit hook signals** the reconciler
so students get instant feedback, and a **durable timer poll** catches what nobody
committed. The distinction is the lesson: signals carry intent, the timer catches
drift.

### 7. The cross-language contract guards the worker config, not the spec

The namespace spec never leaves Go — the CLI writes it, the Go reconciler reads it,
so a schema file there is overhead. What crosses the seam is the **worker config**:
emitted by Python, consumed by the Python worker at boot *and* by the Go CLI when
it templates the k8s manifest. `schema.json` and the golden round-trip fixture
guard that file only.

### 8. The tutorial runs on a laptop and in the sandbox, from one set of commands

Every challenge must be runnable on a developer's own machine — macOS included —
and inside the Instruqt sandbox, from the same repo, with the same lab text. Not
"portable in principle": actually run, both places, before a cohort.

Two reasons, and the first is selfish. The track is authored and tested on a Mac.
A workshop that can only be exercised inside Instruqt has a feedback loop measured
in sandbox rebuilds, which means it gets exercised rarely and the bugs are found by
students. The second is that a platform engineer who wants to keep going after the
workshop has a repo that works, rather than one that assumed a VM somebody else
paid for.

This is a constraint on implementation, not a feature, and it has teeth:

- **No systemd anywhere a student touches.** macOS has no `systemctl`. Long-running
  services are pods; scripts that must know detect the init system rather than
  assuming one. This is the single biggest reason the control plane moved from a
  systemd unit to a Deployment.
- **One address for a service, correct in both places.** Vault runs in the cluster
  and its CLI runs on the host — every challenge reads a secret by hand — so it is
  reached on a NodePort, not on `127.0.0.1:8200`. NodePort routing is **not**
  universal: k3s on the sandbox routes it (the host *is* the node), k3d needs
  `-p "30820:30820@server:0"` at cluster creation, and Docker Desktop's kind-based
  Kubernetes does not publish NodePorts to the host at all. So bring-up probes the
  port and falls back to a `kubectl port-forward` on the same number. The address in
  the lab text is identical everywhere, which is the whole point.
- **Image delivery branches on the cluster, not the OS.** k3s runs its own
  containerd and needs `ctr images import`; k3d wraps that; Docker Desktop *may or
  may not* share the Docker daemon — kubeadm-provisioned does, kind-provisioned
  (node `desktop-control-plane`) does not, and both report the context
  `docker-desktop`. So the branch is on the node, never the context name.
- **Bring-up creates the cluster it needs.** `platform-up` starts a stopped k3d
  cluster, creates one if there is none, and switches to one if the current
  context cannot take locally built images. "Install k3d and run this other
  command first" was a step the script could take itself.
- **And refuses the ones it does not recognise.** kubectl's context is global
  state anything on the machine can change. Deploying a Vault holding a live Cloud
  credential into somebody's real EKS cluster is the one mistake here that
  deleting a namespace does not undo, so unfamiliar contexts are refused by name
  unless `WORKSHOP_ALLOW_CLUSTER=1` says otherwise.
- **Every input falls back: argument, environment, prompt.** `workshop` is
  driven non-interactively by the sandbox, where the values are already in
  `/etc/workshop/env`, and asks on a laptop, where they are not. Nothing requires a
  TTY unless a value is genuinely missing. Its env file is `/etc/workshop/env` as
  root and `~/.workshop-env` otherwise.

What this does **not** mean is parity of provisioning. The sandbox pre-warms the
Terraform provider cache and pre-builds the worker image; a laptop pays those costs
on first use. The lab commands are the same. The setup is not, and
pretending otherwise would mean shipping a laptop setup nobody runs.

### 9. A change is not done until the lab says so

The lab text is the interface. Nobody exercises this workshop by reading the repo —
they follow the instructions, in order, typing what they are told to type. A change
that lands in the code but not in the lab text is therefore not a partial change.
It is a broken workshop, and it breaks at the exact moment someone is trusting the
instructions rather than checking them.

So every change to **what a student types, what they see, or what must be true
before a step** carries its lab edit in the same commit. There is now exactly one
surface for that text:

| Surface | What it is |
|---|---|
| `portal/src/course/labs/lab<n>.ts` | the portal's steps, snippets and checkpoints |

Instruqt used to carry a second copy — one `assignment.md` per challenge, the same
instructions in prose form. It was dropped. Two copies of the same instruction is
two things to update and one of them to forget, and the duplication bought nothing:
the portal already personalises every command with the student's username, cohort
and region, which an assignment file cannot do. Instruqt is now the sandbox, and
`instruqt/track/01-workshop/assignment.md` is one thin challenge that says so and
carries the tab config.

The failure mode is specific and unusually expensive. Someone follows a stale
instruction, hits an error the code does not actually have, and debugs the wrong
thing — the instruction, the environment and the code all disagree, and only one of
them is wrong. Two changes in this design would have done exactly that: moving Vault
into k3s changed its address from `127.0.0.1:8200` to a NodePort, so every
`vault kv get` in the lab text would have failed for a reason the lab did not
mention; and embedding the Terraform module in the worker binary made `tpctl apply`
depend on a rebuild step that no lab had.

`pnpm snippets:check` guards what it can — that every snippet claim and grade id
resolves — and `./scripts/workshop verify` compiles the answers. Neither can tell
whether prose still describes reality. That part is a human obligation, which is why
it is written down as a rule rather than left to a linter.

### 10. Automation announces itself; it never hides what it did

Every script a student runs explains each step **before** taking it, in the
vocabulary the labs use, and — when a human is watching — waits for a keypress
before continuing.

This is not a usability nicety, it is the thesis. The workshop's claim is that a
platform is something you can build and reason about rather than something that
happens to you. A bring-up script that prints forty lines of `kubectl` output and
ends with "Control plane is up" teaches the opposite lesson, and teaches it in the
first ten minutes: the platform is a black box, and the way to operate it is to run
the magic command and hope. A student who cannot say what `platform-up` did cannot
debug it at 3am, and cannot rebuild it at their own company, which is the entire
point of the four hours.

It also pays for itself the first time something breaks. The failure the workshop
actually hit — a Docker Desktop cluster that silently could not see a locally built
image — was invisible precisely because the script said "nothing to import" and
moved on. Steps that name what they are about to do turn that class of bug from a
mystery forty seconds later into a sentence you were just shown.

The obligations, in order of how easily they are forgotten:

- **Announce before, not after.** "About to write the platform-env ConfigMap, and
  here is what goes in it" is teaching. "Wrote configmap/platform-env" is a log
  line.
- **Say why, not just what.** The step that configures Kubernetes auth explains
  that it is what lets the pod hold no token in its manifest. Without the why, the
  pause is just friction.
- **Never block a machine.** Waiting requires a TTY. The sandbox provisioner, CI
  and `make up` inside another script must run start to finish untouched, so the
  pause is skipped when stdin is not a terminal, and `WORKSHOP_YES=1` (or
  `workshop platform-up --yes`) opts out explicitly for the fifth run of the
  morning. This is the same argument-environment-prompt ladder as rule 8.
- **A skipped pause still prints.** Opting out of waiting is not opting out of the
  explanation, or the log stops being a record of what happened.
- **Colour separates the three voices.** Cyan for what is about to happen, dim for
  why, yellow for the one line asking something of you — so a student scanning a
  screenful can find the next action without reading it all. Suppressed when stdout
  is not a terminal and when `NO_COLOR` is set, because the sandbox captures this
  into a log where escape codes are noise.
- **Teardown is exempt.** The rule exists so a student understands what is being
  *built*. Narrating a `platform-down` they just asked for is friction in front of
  the thing they wanted.
- **The words match the labs.** A step that calls something a "control namespace"
  while the lab calls it something else has added a second vocabulary to learn.

The rule applies to anything that provisions or deploys. It does not apply to
`tpctl`, which is the product surface a developer uses and should feel fast — a
paved road that pauses to explain itself is not paved.

---

## Specs

### Namespace spec — `specs/<name>.yaml`

Written by the CLI's interactive wizard. Fields follow the talk's own tool
(`name`, `owner`, `tier`, retention).

| Field | Purpose |
|---|---|
| `name` | Logical name. One spec fans out to two physical namespaces. |
| `owner` | Who to page. Drives access grants and, in a real platform, alert routing. |
| `tier` | Policy hook. Nothing consumes it yet — its presence teaches spec-as-policy. |
| `retention` | Days. |
| `environments` | `[staging]` by default; `[staging, prod]` when asked for. One region. The default is one because namespaces are quota-bound, and challenge 2 opts into two deliberately so the fan-out has something to fan out to. |
| `stateBackend` | `local` (default) or `s3`. |

The CLI is an **interactive wizard by default, with a flag for every prompt and
`--non-interactive`.** The wizard is the demo-able artifact that makes the platform
feel like a product; the flags are what make it gradable, scriptable, and
copy-pasteable from an assignment page. Every real platform CLI has both.

### Worker config

Generated, never hand-written. Guarded by `schema.json`, validated by Python on
emit and on boot, and by Go before it templates a manifest.

### Resources provisioned

In: `temporalcloud_namespace`, namespace-scoped `temporalcloud_service_account`,
`temporalcloud_namespace_tags`. API keys are minted outside Terraform (rule 2).

Out, with reasons: `group` / `group_access` need an IdP story the workshop does not
have; `nexus_endpoint` names are account-global and a collision minefield across a
self-paced cohort; `metrics_endpoint` needs account-scoped access the platform
identity deliberately lacks.

---

## Identity matrix

| Principal | Role | Why |
|---|---|---|
| Platform service account | **Developer** | Least privilege, and provably sufficient (rule 3) |
| Student user | **Global Admin** | Needed to see namespaces the platform SA created, which every challenge from 2 onward asks for |
| Managed worker SA | Namespace-scoped, `write` | Data plane only — polls a queue, completes tasks |
| Grader | Account-scoped read | Portal precedent; read-only wrapper |

The asymmetry between the first two rows is a teaching beat, not an embarrassment:
*"You hold Global Admin because this is a workshop and you need to see everything.
Your platform holds Developer because that is what production looks like — and
notice it was enough."*

Granting a user namespace access is a user-management operation requiring Global
Admin, so the platform SA cannot do it — which is why the *reconcile path* holds
only a Developer credential, and rule 3 stays true.

**The portal is the exception, and it is deliberate.** Creating a Cloud user is an
account-admin operation, and students now choose their own username at join time,
so nothing can pre-provision them. The portal therefore holds an account-owner key.
This is the second elevated credential the design previously avoided, accepted in
exchange for the join flow, and bounded by a short key expiry rather than by scope.
See *Identity via Authentik*.

Students authenticate by SAML against an Authentik tenant rather than an emailed invite
link — see *Identity via SAML*. The role assignments above are unchanged.

---

## The four challenges

1. **Bootstrap by hand.** Mint the platform's service account and hand its key to
   Vault. Write the Terraform module that makes a namespace, then apply it yourself
   — once — to create the namespace the namespace-creator will run in. By hand on
   purpose: something has to break the chicken-and-egg, and a student's first twenty
   minutes need a visible win that no control loop can silently withhold.
   *Graded:* namespace exists with api-key auth and the right retention, via Ops API.

2. **Fan-out and identity.** Parent entity workflow, one child per environment.
   Namespace-scoped service account per environment; the API key minted outside
   Terraform and written to Vault, the activity returning only a path.
   *Graded:* two namespaces and two service accounts via Ops API; Vault path resolves.

3. **Invert to declarative.** Same activities, new driver: `tpctl sync` delivers
   the spec by signal-with-start, and the reconciler takes it from there. Change
   retention in the Cloud UI behind its back and watch the timer catch it and put
   it back.
   *Graded:* a reconciler exists for the spec, and a retention change nobody
   committed was detected **and corrected** — `reconciles`, `driftsDetected`,
   `lastDrift` naming retention, and the namespace actually back at the spec's
   value. All four come from the reconciler's Query handler, which is the
   argument for it being a workflow: the Ops API can show that a namespace is
   correct, but never that a loop noticed it was wrong.

   Environment removal used to be graded here, justified as what held the
   namespace budget. It is gone: the budget is held further upstream now, by
   `tpctl new` defaulting to one environment rather than two.

4. **The paved road.** A decorated workflow declares its own queue and namespace;
   `gen-config` emits worker config; `tpctl deploy` grants the worker its Vault
   identity, builds the image, templates the manifest and lands the worker on k3s.
   The student then calls their own workflow and watches it complete in the Cloud
   UI — the demonstration of time-to-first-workflow that the stopwatch challenge
   used to make with a timer.

   Kubernetes auth used to be a graded step here, performed by hand. It is now
   part of `deploy`, because granting a workload its identity belongs with
   deploying the workload: doing it afterwards leaves a window where the
   Deployment exists and crash-loops, and leaves the grant to a step somebody
   forgets — which is how a role ends up bound to `default` because that made the
   error go away. The lesson survives in the manifest-reading step, which asks the
   student to look for a credential and not find one.
   *Graded:* worker pod healthy, polling the right queue in the right namespace,
   and its workflow ran to completion.

---

## Supporting services and identity

One IdP, no mail, and no state service. Authentik runs on Fly.io and is operated by
the instructor; identity is not a service you build. Terraform state is a local
file, so there is nothing else to stand up, reach or authenticate to.

The implemented layout: `cmd/tpctl` and `cmd/platform-worker` (Go binaries),
`internal/platform` (workflows and activities), `internal/tfexec` and
`internal/tfworkspace` (ported from temporal-terraform-demo), `internal/cloudops`,
`internal/vaultkv`, `internal/spec`, `internal/workerconfig`, `terraform/namespace`
(embedded module), `worker/` (the Python managed worker), `schema/`, `specs/`,
`instruqt/`, `hooks/post-commit`.

### Terraform state

**A local file**, one per physical namespace, under `.platform-state/<username>/
<logical-ns>/<env>.tfstate`. Selected by `stateBackend: local`, which is the default.

The workshop ran an HTTP state service on Fly for a while, and dropped it. It was
one more thing to deploy, one more per-student credential to mint and hand over,
and one more way for a sandbox with no egress to fail on challenge 1 — the portal's
documented number-one sandbox complaint. A file on the box the student is already
sitting in front of is debuggable with `cat`, and `stateBackend: s3` remains as
proof that the backend interface is real rather than one implementation wearing a
costume.

In the sandbox the control plane runs on k3s, so its state directory is a
`PersistentVolumeClaim` — state survives the pod, and challenge 4 rolls that
Deployment as part of the lab. It does not survive the sandbox: local-path writes
to the node. That is exactly why `AttemptImport` ports over from the demo rather
than being dropped: it re-adopts orphaned resources instead of duplicating
them.

### Identity via Authentik

**No mail anywhere in this design.** Students authenticate against a **self-hosted
[Authentik](https://github.com/goauthentik/authentik)** tenant configured as the
account's SAML IdP, deployed to Fly.

This dissolves the constraint that motivated a mail relay in the first place — one
email address maps to one Temporal Cloud account permanently, so a platform
engineer whose work address already sits in another account is un-invitable. Under
SAML the address is a workshop-owned identifier, not their real mailbox.

**Confirmed:** a user created through the Ops API can complete a SAML login without
ever opening the invitation Temporal sends. The no-mail design rests on this and it
is no longer contingent.

#### Why not Okta

Okta developer edition was the original choice, on availability grounds: Entra ID
gates SAML for custom apps behind a paid tier, and Google Workspace's Temporal
setup instructions were unfinished. It was displaced by a limit, not a preference —
**its user cap is lower than a cohort plus the cohorts before it**, and identities
are reused across cohorts. Temporal Cloud's own user limit is 300 per account, so
Temporal was never the binding constraint.

The price is honest and worth stating. Okta's availability was somebody else's
problem; Authentik's is ours, and it is a **total-outage dependency** — if it is
down at 09:00 nobody logs into Temporal Cloud and the workshop cannot start.
Accepted deliberately.

#### The two pieces of state that cannot be rebuilt

Both cost a support ticket with weeks of lead time if lost, because Temporal's SAML
configuration is not self-service and pins the IdP's sign-in URL and certificate.

| | Where it lives | Why it cannot be regenerated |
|---|---|---|
| SAML signing keypair | A **Fly secret**, generated outside Authentik | Temporal holds the certificate. A fresh one means a new ticket. |
| Authentik's database | **Fly Managed Postgres**, with backups | It holds every student's registration, and nothing else can rebuild it. |

Authentik generates a self-signed signing certificate on first boot, which would
tie the SAML config to one deployment forever. Generating the keypair outside it
and injecting it is what makes the Fly app rebuildable. **Restore from a Postgres
backup once, before the first cohort** — an untested backup is not a backup, and
this is the one database in the workshop with no other copy.

#### Identities are created at join time, not provisioned in advance

The earlier design pre-provisioned fifteen fixed `student-NN@<domain>` identities
with `temporalcloud_user` in Terraform, each bound to a slot. That is retired along
with slots — see *Names are recyclable* below.

Instead: **a student types the username they want**, and the portal provisions it.
One identifier, chosen by the person who has to remember it.

- Validated `^[a-z][a-z0-9-]{1,13}$` — 2 to 14 characters. Not arbitrary: the username becomes part of a
  namespace name, which Cloud caps at 39 characters and restricts to lowercase
  letters, numbers and hyphens. The budget is shared with the spec name —
  `ws-` + 14 + `-` + 12 + `-staging` is 38 — so `tpctl new` caps spec names at 12.
  Both are validated at the point of typing, because the same rejection arriving
  from a Terraform activity reads as a broken module.
- **A repeat username is a return, not a conflict.** Same participant: the password
  is reset and shown again. Different participant: rejected. Recovery and conflict
  are one code path, which is the whole of "I closed the tab".
- The portal assigns **Global Admin**, as the identity matrix already specifies —
  students must see namespaces their platform's service account created, which
  every challenge from 2 onward asks them to do.
- Registration is **refused past the cohort cap**. "The workshop is full, see the
  instructor" at join is a conversation; running out of namespaces at 11:00 is an
  outage that lands on whoever applies next.

#### The username is the only key

It replaces the Instruqt participant id everywhere the workshop identified a
student: Vault paths (`secret/namespaces/<username>/...`), tfstate paths, the
namespace tag the grader reads, and the namespace name itself. One identifier,
chosen by the person who has to remember it, and legible in a Vault path in a way
that `secret/namespaces/a3f9c2.../` never was.

It reaches the sandbox the same way every other value does —
`workshop init --username <name>` — which is why it also works on a laptop
where no participant id exists. The sandbox prints a **bare join link**; the portal
issues the personalised, HMAC-signed one back, and that URL is the thing a student
bookmarks and the recovery path they return through.

Workshop state — which username, which cohort — is stored as **Authentik user
attributes** through its API. No second datastore, and nothing writes Authentik's
schema behind its back, because Authentik migrates on every upgrade.

**In Authentik the username is the full address**, `tao@temporal.workshop`, and the
bare handle lives in `name`. That is not cosmetic: the SAML assertion carries the
username, and Temporal Cloud creates nothing just-in-time — an assertion naming a
bare `tao` arrives for a user the account has never seen and is rejected at a
student's first login, in front of the room. So the portal provisions both sides at
the same string, and re-establishes it on every join rather than trusting that the
first one held: an account made by hand, or under an earlier convention, converges
instead of quietly failing one hop from its cause.

**The accepted risk.** Creating a Temporal Cloud user is an account-admin
operation, so the portal holds an **account-owner API key** — a public web service
with a credential that can create and grant any user. This is the second elevated
credential the design previously went out of its way to avoid, and it is accepted
knowingly in exchange for self-chosen usernames and a portal-driven join. Give the
key a **short expiry** so a forgotten deployment stops being a liability on its own.

#### The kill switch is deliberately two things

Deactivating the Authentik user is instant and needs no Cloud call. Revoking
Cloud-side does not depend on our own Fly app being up. **Both are kept on
purpose** — a kill switch that shares a failure domain with the thing it switches
off is not one — and this note exists so that neither is later deleted as
redundant.

The domain is **`temporal.workshop`**, fixed for every cohort. It is an identifier
namespace and nothing else: **no MX, no SPF, no DKIM, no mailbox.**

It does not resolve, on purpose. `.workshop` is not a delegated TLD, so the name
cannot be registered by anyone and therefore cannot collide with a real Temporal
Cloud account, and cannot capture logins for a domain somebody actually uses.
Whether support will map an IdP domain absent from DNS is the one thing to confirm
in the ticket; the fallback is a subdomain you own, never an apex.

---

## Sandbox

`n1-standard-4`, 16 GB, k3s. The portal's build already needs this for uv plus
Docker plus code-server; this one drops Prometheus and Grafana but adds a Go
toolchain, k3s and the Vault CLI.

Prebuilt aggressively:

- Go toolchain, module cache warm; `uv sync` complete
- `terraform` plus a **warm provider plugin cache** — a cold `terraform init`
  against `temporalio/temporalcloud` is a silent two-minute stall on challenge 1
- Vault **CLI** only. The server is a pod on k3s
- `temporal`, **plus the `temporal-cloud` binary** — `temporal cloud` is a separate
  download that the CLI discovers on `PATH`, not part of the CLI, and it is the
  prerequisite people most often arrive without. Asserted at build time on
  `temporal cloud whoami --help`, because `temporal cloud --help` succeeds with no
  extension installed at all and therefore proves nothing
- k3s **started and enabled**, its own system images pulled. This used to be
  "installed, not started", from when the cluster first appeared in challenge 4;
  Vault runs on it now, so it is challenge-1 material and a first start is a
  minute of image pulls at the first prompt of the day
- **Both** images — `platform-worker:dev` (the Go control plane) and
  `managed-worker:dev` (the Python worker a team deploys) — built and staged in
  k3s's image store, plus `hashicorp/vault`, so nothing pulls from a registry
  mid-challenge
- code-server on 8443 behind the Editor tab, and a `code` shim on `PATH`, because
  four lab steps are `code <file>`

Deliberately **not** prebuilt: Vault itself, the control plane, and any Temporal
server. Vault runs in dev mode, so anything seeded into it dies when the snapshot
boots; the control plane is what the student deploys in challenge 2, onto the
namespace their own Terraform made in challenge 1, and having one already running
gives the bootstrap away. There is no local dev server anywhere in the workshop.

k3s over k3d **in the sandbox**: the Kubernetes-auth switch in challenge 4 is more
honest against a real kubelet, and nothing is torn down repeatedly.

### Measured, not guessed

The setup script runs on the sandbox as it starts — `sandbox publish` builds
nothing — so all of this is time a student spends on the loading screen. From a
green `instruqt track test`, 2026-08-31:

| Stage | Took |
|---|---|
| apt, Go, uv, terraform, vault, temporal, k9s, code-server | 47s |
| k3s install | 15s |
| clone, `go build ./...`, `go mod download` | 64s |
| `uv sync` | 1s |
| two image builds + the Vault pull + three `docker save`s | 117s |
| k3s start, node Ready, image-store import | 28s |
| env file, egress probes | 3s |
| **total** | **280s** |

Two things that table settles. The image builds are the single biggest line and
worth keeping an eye on; and the Vault image needed one retry before containerd
had it, which is why the image-store check retries rather than asserting once — it
would otherwise have failed this very run.

On a laptop the same manifests run on k3d or Docker Desktop's Kubernetes, because
k3s does not run natively on macOS (rule 8). That is a difference in the cluster,
not in the workshop: the manifests, the NodePort and the lab commands are
unchanged, and only `make k3s-import` cares which one it is talking to.

---

## Numbers, quotas and lead times

| Item | Value | Note |
|---|---|---|
| Students | **15** | 45 of 50 namespaces. See *The namespace budget* below |
| Namespaces per student, peak | **3** | control + staging + prod, one region |
| **Namespace quota** | **50** | Default is 10; documented as auto-increasing, but not something to discover on the morning |
| Cloud user limit | 300 per account | Never the binding constraint — the IdP's cap was |
| Cloud metrics budget | 180 req/hour **per account** | Largely moot — `metrics_endpoint` is out of scope |
| Authentik tenant | 1, self-hosted on Fly | Unlimited identities; see *Identity via Authentik* |

### The namespace budget

This is the tightest constraint in the workshop and every other number is derived
from it.

The control plane runs on **its own Cloud namespace per student** — that is the
bootstrap punchline, and it costs a third of the account. Add the fan-out from
challenge 2 and the peak is three:

| | control | staging | prod / payments | total |
|---|---|---|---|---|
| Peak, per student | 1 | 1 | — | **2** |

15 × 2 = **30 of 50**, twenty spare. That headroom used to be five, and holding it
took three mechanisms and a graded teardown. Two changes retired all of that:

1. **`tpctl new` defaults to one environment.** A namespace is a finite account
   resource, so the default is the least that works and asking for two is a flag.
   The budget is held before anything is created, rather than clawed back
   afterwards by a step a student can skip.
2. **The stopwatch challenge is gone**, and with it the second spec every student
   provisioned at the very end — both the largest single draw and the one that
   arrived when the account was already fullest.

The remaining mechanism is still worth having:

3. **The reconciler pre-checks remaining quota** before an apply and fails with the
   real cause. Without it, hitting the cap surfaces as a Cloud error inside a
   Terraform activity, which reads as *"my module is wrong"* and sends a student
   debugging their own HCL. A control plane that enforces a policy is on-thesis,
   not a workaround.

### Names are recyclable

**A deleted Temporal Cloud namespace name can be recreated.** This is worth stating
plainly because an earlier version of this design asserted the opposite, and built
a slot pool on it.

That reasoning was also circular. If names *were* reserved, `ws-7-orders-staging`
would burn on deletion exactly as `ws-alice-orders-staging` would — and slots would
be strictly worse, because a participant-derived scheme burns a fresh name per
cohort while a slot-derived one burns a fixed small set and breaks on the second
cohort. Slots never solved the problem they were introduced for.

So **slots are retired**, along with `SlotPoolWorkflow`, `tpctl slot` and the
reaper. Physical names are `ws-<username>-<spec>-<env>`, derived from the name the
student chose. What the slot pool was really allocating — a scarce pre-provisioned
identity — is gone too, now that identities are created at join time.

### Reaping

**There isn't any, during the workshop.** A 15-seat cohort inside a 50-namespace
quota, with registration refused past the cap, prevents the pressure a reaper
existed to relieve. An unattended process deleting namespaces on a TTL is how a
student who came back from lunch loses their work.

Teardown is an **instructor script**, run deliberately after each workshop, and it
deletes namespaces, Cloud users and Authentik users. It scopes itself by a
**`cohort` tag** written into the reconciler's tag set — `cohort=2026-03-melbourne`
— rather than by matching the `ws-` prefix, because deletion is irreversible and
prefix-matching has no guard. The same tag lets the instructor view report cohort
usage against the quota, which is the number to watch when five spare is the
margin.

### Critical path — start now

1. **Authentik on Fly, with an externally generated signing keypair.** Do this
   first, because item 2 needs its sign-in URL and certificate — and because
   regenerating either afterwards means re-filing item 2.
2. **SAML enablement.** SSO is **not self-service**: the ticket must carry the IdP
   sign-in URL, the X.509 certificate in PEM, and the IdP domain to map. Fold two
   more asks into the same ticket — disable social logins, and the namespace quota.
3. **Namespace quota for 50.** Weeks of lead time; same ticket. Documented as
   auto-increasing, but that is not a thing to discover on the morning.
4. **The domain.** Free, self-service, an identifier namespace only. No MX.
5. **Restore the Authentik Postgres from a backup, once.** It holds every
   registration and nothing else can rebuild it. An untested backup is not a backup.

Everything else is code, and code can be written on a weekend.

---

## Deliberate non-goals

Named so they read as decisions rather than gaps.

| Excluded | Why |
|---|---|
| The Go proxy from the talk | The most seductive and wrongest choice — a week of work teaching gRPC interception, not platform design. Ten-minute discussion instead |
| Kubernetes operator | The whole point is that a Temporal workflow is the better control loop |
| Terraform state locking | Rule 1 — the absence *is* the lesson |
| Self-hosted Temporal via Helm | Fifteen minutes and 8 GB to teach nothing about platform engineering |
| Worker versioning | Even OpenAI skipped it; replay testing in CI is the transferable lesson |
| Scaffolding a developer's repo | Doubles the build and adds a second control loop |
| Groups, Nexus, metrics endpoints | See *Resources provisioned* |
| Mail relay, Postmark, Google Workspace | Replaced by SAML — no inbound mail anywhere in the design |
| SCIM | Identities are created at join and deleted at teardown; there is no lifecycle to sync |
| A slot pool | Retired. It solved name reservation, which does not exist — see *Names are recyclable* |
| Self-service slot selection | One slot is identical to another; choice invites a race and buys nothing. The recovery path was the real requirement |

---

## Open risks

1. **Challenge 4 remains the fattest slot** even with the image pre-built. Watch it
   in the first dry run; the fallback is splitting it across 4 and 5, which costs
   the stopwatch.
2. **Students hold Global Admin.** Same blast radius the portal already accepts
   (its sharp edges #4 and #6). A griefing student can delete another's namespaces,
   and with slots retired there is no longer a naming convention that limits which.
3. **The portal holds an account-owner key.** A public web service with a
   credential that can create and grant any Cloud user. Accepted knowingly in
   exchange for self-chosen usernames; bounded by key expiry rather than by scope,
   which means the expiry is load-bearing and must actually be set.
4. **Authentik is a total-outage dependency.** Down at 09:00 means nobody logs into
   Temporal Cloud and the workshop does not start. Okta's availability was somebody
   else's problem; this is ours.
5. **Namespace headroom is no longer tight.** 15 students × 2 is 30 of 50, and the
   margin now comes from the default rather than from a step anyone can skip — see
   *Numbers, quotas and lead times*. The reconciler's quota pre-check stays, because
   the failure it prevents lands on whoever applies next rather than on whoever
   caused it. A sixteenth attendee now fits; a thirtieth does not.
6. **Local state does not outlive the sandbox.** A `PersistentVolumeClaim` backs
the control plane's state directory, so it survives `./scripts/workshop reload`, a
crash and a reschedule — but local-path writes to the node, and destroying the
sandbox destroys it. `AttemptImport` re-adopts the orphans, so a rebuilt sandbox is a
slow first apply rather than a lost namespace.
7. **Sandbox boot time** is unmeasured and the prebuild list is long.
8. **Authentik becomes the access control plane.** Between cohorts, standing Global
   Admin users sit in the account gated only by Authentik — an IdP we now operate.
   A misconfigured tenant is a live-credential problem, not an inconvenience. The
   instructor teardown script is the mitigation, and it has to actually be run.

*Resolved since the first draft:* whether a pre-created, never-accepted user can
complete a SAML login without opening the invitation email. It can. The no-mail
design is no longer contingent.
