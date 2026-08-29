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
final challenge measures it with a stopwatch.

The architecture takes one deliberate position against its own source material.
OpenAI replaced Terraform with a Kubernetes operator because Terraform was making
them slow. We keep Terraform as the execution engine inside a single activity, and
build the control loop as a **Temporal entity workflow instead of a k8s
controller** — because a workflow is a strictly better operator: durable by
construction, retryable, auditable, and able to wait on a human. That claim is the
subject of a ten-minute discussion in challenge 5, not a lab.

---

## Audience and format

| | |
|---|---|
| Audience | Platform engineers who will build this at their own company |
| Format | Self-paced-capable Instruqt track; instructor-led guide layered on top |
| Shape | 5 challenges, ~4 hours |
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

  decorated workflow         nsctl  ── interactive wizard      namespace (staging)
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
    tfstate service — HTTP backend on Fly.io, per-student, volume-backed, no locking
    Authentik       — SAML IdP on Fly. Usernames chosen at join. No mail anywhere
```

### The language seam

Go for the platform, Python for the product. This is the OpenAI split exactly
(Go tooling, Python workers), and it puts the seam on the boundary the workshop is
teaching rather than in an arbitrary place.

| Side | Language | Contents |
|---|---|---|
| Platform | Go | `nsctl` CLI, reconciler workflows, Terraform activities, mint-key activity |
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
| Platform worker | Go | Reconciler workflows, Terraform + mint-key activities | `temporal server start-dev`, pointed at the control-plane namespace the student's own CLI provisioned in challenge 1 |
| Managed worker | Python | The developer's decorated workflows | k3s in the sandbox, deployed by the platform in challenge 4 |

Only the managed worker moves to Kubernetes. A platform's control plane is central
infrastructure that already exists; the managed worker is the per-team artifact the
platform produces. So challenge 4 reads as *"your platform deployed someone else's
worker"* — the paved road working — rather than as a redeployment of your own.

The control plane running on a namespace it provisioned itself is the bootstrap
punchline: **the control plane's first customer is itself.**

---

## Load-bearing design rules

Nine rules carry the design. Each one is a lesson as much as an implementation
choice — except the last two, which are constraints on how the other seven get
built and maintained.

### 1. Workflow ID is the resource identity, so Temporal is the lock

One entity workflow per logical namespace, keyed on its name and started with
`signal-with-start`; one child workflow per physical namespace. Temporal's own
workflow-ID uniqueness constraint gives single-writer-per-resource for free.

Therefore: **no DynamoDB lock table, no lease, no `terraform force-unlock`, and the
state service implements no `LOCK`/`UNLOCK` endpoints at all.** Terraform's `http`
backend treats locking as optional — omit `lock_address` and it never locks.

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
this because that is where the decorators are; `nsctl worker gen-config` is a
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
  containerd and needs `ctr images import`; k3d wraps that; Docker Desktop shares
  the Docker daemon and needs no import at all. `make k3s-import` asks which it is.
- **Every input falls back: argument, environment, prompt.** `workshop-creds` is
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
before a step** carries its lab edit in the same commit. There are two surfaces and
both are load-bearing:

| Surface | What it is |
|---|---|
| `portal/src/course/labs/lab<n>.ts` | the portal's steps, snippets and checkpoints |
| `instruqt/track/<nn>-*/assignment.md` | the in-sandbox text, and the tab config |

The failure mode is specific and unusually expensive. Someone follows a stale
instruction, hits an error the code does not actually have, and debugs the wrong
thing — the instruction, the environment and the code all disagree, and only one of
them is wrong. Two changes in this design would have done exactly that: moving Vault
into k3s changed its address from `127.0.0.1:8200` to a NodePort, so every
`vault kv get` in the lab text would have failed for a reason the lab did not
mention; and embedding the Terraform module in the worker binary made `nsctl apply`
depend on a rebuild step that no lab had.

`pnpm snippets:check` guards what it can — that every snippet claim and grade id
resolves — and `make verify` compiles the answers. Neither can tell whether prose
still describes reality. That part is a human obligation, which is why it is written
down as a rule rather than left to a linter.

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
| `environments` | `[staging, prod]`. One region. |
| `stateBackend` | `http` (default) or `local`. |

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
| Student user | **Global Admin** | Needed to see namespaces the platform SA created; challenge 5 depends on it |
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

## The five challenges

1. **Spec to workflow.** Write the spec schema. `nsctl apply -f` starts a workflow;
   one activity runs Terraform; one namespace appears. Imperative on purpose — a
   student's first twenty minutes need a visible win, and a declarative loop that
   silently does nothing has four candidate failure points.
   *Graded:* namespace exists with the right retention, via Ops API.

2. **Fan-out and identity.** Parent entity workflow, one child per environment.
   Namespace-scoped service account per environment; the API key minted outside
   Terraform and written to Vault, the activity returning only a path.
   *Graded:* two namespaces and two service accounts via Ops API; Vault path resolves.

3. **Invert to declarative.** Same activities, new driver: commit the spec, the hook
   signals, the reconciler reconciles. Change retention in the Cloud UI behind its
   back and watch the timer catch the drift. Delete an environment and watch cleanup.
   *Graded:* Query the reconciler for a drift-corrected result, **and the removed
   environment is actually gone** — that second check is what holds the namespace
   budget at three per student, so it is mandatory rather than illustrative.

4. **The paved road.** A decorated workflow declares its own queue and namespace;
   `gen-config` emits worker config; `nsctl` templates the manifest; the worker
   lands on k3s. Vault auth switches from root token to Kubernetes auth as a graded
   step — the one moment where "the worker moved into the cluster" has a consequence
   the student must handle rather than observe.
   *Graded:* worker pod healthy, polling the right queue in the right namespace.

5. **Be the developer.** New persona, empty directory, **stopwatch**. From nothing
   to a completed workflow using only the platform you built — one spec, one
   environment (`--environments staging`), which keeps the peak at three namespaces
   without costing the challenge anything: a new team's first ask is rarely both
   environments. Then ten minutes on why OpenAI abandoned Terraform for an operator,
   and what a Temporal-based control loop gets right that a k8s controller cannot.
   *Graded:* a workflow completed in the provisioned namespace within N minutes of
   the challenge starting.

Challenge 4 is the fattest and least forgiving — every failure there is a container
failure rather than a platform lesson. Mitigation: the worker image is **pre-built
and pre-imported into k3s** during sandbox provisioning, so the challenge is
configuration and deployment, not `docker build`.

### Lab pedagogy

Five files are prose stubs a student writes; everything else is provided.

This follows the training portal's split, which is sharper than it first looks.
Across its five `lab*.tf` files the portal ships **176 lines of prose and zero
lines of code** — students write every Terraform resource. Its Python worker labs
are the opposite: 41 to 201 code lines each, thin entrypoints over a provided
`training/` package that students only ever *run*. It never asks anyone to write
Python. It asks them to write the declarative, low-syntax-risk, Cloud-gradable
layer.

Applied here:

| File | Challenge | Lesson |
|---|---|---|
| `terraform/namespace/main.tf`, `outputs.tf` | 1 | The module, and why `temporalcloud_apikey` is absent from it |
| `internal/platform/environment.go` | 2 | The fan-out child, and what a return value costs you |
| `internal/platform/wait.go` | 3 | Signals carry intent; the timer catches reality |
| `worker/workflows/greeting.py` | 4 | The decorator is the declaration |

Two deviations from the portal, both deliberate. **Go is stubbed at all**, against
the portal's instinct — but the reconciler's wait and the fan-out child are the two
best lessons in the repo, and reading them is not the same as writing them. And
`MintNamespaceKey` is *not* stubbed even though it carries rule 2, because it is
mostly Cloud Ops API plumbing; the same lesson lands harder in
`EnvironmentWorkflow`, where it shows up as a decision about what to return.

Mechanism: Go stubs return a non-retryable application error rather than panicking,
so the message propagates through the parent workflow, the CLI and the Temporal UI.
A panic would retry forever and say nothing. `_stubs/` is underscore-prefixed so the
Go toolchain ignores it outright.

**Where the answers live.** In the portal, as the snippets students read — one copy,
and it is the copy they actually see, rendered inside the step that asks for the
file rather than collected at the foot of the page. Every lab has one, behind a single click,
because with no solutions directory a lab without a snippet would have no reference
answer anywhere: not for a stuck student, not for an instructor, not for CI. The
disclosure carries the training portal's own line, which is the right one: *type it
rather than pasting it if you have the time, the arguments are the lesson.*

The obvious hazard is rot — nothing compiles a TypeScript string literal. So
`pnpm snippets:emit` writes every path-backed snippet to its real path and
`make verify` compiles and tests it there before restoring the stubs. That is
strictly better than the solutions directory it replaced, because it checks the
string the student is shown rather than a file that resembles it.

The unit tests double as the student's feedback loop, which the portal has no
equivalent of because HCL has none. `make test` and `make lab-test` therefore
**fail on a fresh clone, on purpose**; `make verify` applies the solutions, runs
everything and restores the stubs, and is what protects the answer key from rotting.

### Grading strategy

Three layers. Cloud-side state via the **Ops API**, following the portal's
approach. Platform-side behaviour by **Query on the student's own reconciler
workflow** — drift detection is invisible to the Ops API but plainly readable from
workflow state, and it costs one Query handler. And the challenge-5 stopwatch,
which makes the thesis measurable.

Self-paced means nothing can be graded by walking the room. The portal's sharp edge
#7a admits its Grafana dashboard was unverifiable and the mitigation was "look at
screens." That option does not exist here, so every checkpoint must be machine-
verifiable from the Ops API or from inside the sandbox.

---

## Supporting services and identity

One service, one IdP, no mail. The state service runs on Fly.io, is operated by the
instructor, and lives in this repo under `services/state/` with clear separation
from student-facing code — no secrets in the repo, Fly secrets only. Identity is not
a service you build.

The implemented layout: `cmd/nsctl` and `cmd/platform-worker` (Go binaries),
`internal/platform` (workflows and activities), `internal/tfexec` and
`internal/tfworkspace` (ported from temporal-terraform-demo), `internal/cloudops`,
`internal/vaultkv`, `internal/spec`, `internal/workerconfig`, `terraform/namespace`
(embedded module), `worker/` (the Python managed worker), `schema/`, `specs/`,
`services/state/`, `instruqt/`, `hooks/post-commit`.

### Terraform state service

An HTTP backend: `GET` / `POST` / `DELETE`, basic auth, volume-backed.

- Partitioned by path: `/state/<participant-id>/<logical-ns>/<env>`
- Per-student bearer token minted at sandbox setup, injected as `TF_HTTP_PASSWORD`
- **No lock endpoints** (rule 1)
- Remote state also means a student who restarts their sandbox keeps their state

The **local file backend is retained as a working implementation**, selected by
`stateBackend: local`. Not for production — because it is the only thing a student
can debug when the Fly service is unreachable, and egress failure is the portal's
documented number-one sandbox complaint.

A single Fly machine makes "apply succeeded, state write failed" *more* likely than
the demo's original S3 design did. This is exactly why `AttemptImport` ports over
rather than being dropped: it re-adopts orphaned resources instead of duplicating
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

- Validated `^[a-z][a-z0-9-]{1,14}$`. Not arbitrary: the username becomes part of a
  namespace name, which Cloud caps at 39 characters and restricts to lowercase
  letters, numbers and hyphens. The budget is shared with the spec name —
  `ws-` + 14 + `-` + 12 + `-staging` is 38 — so `nsctl new` caps spec names at 12.
  Both are validated at the point of typing, because the same rejection arriving
  from a Terraform activity reads as a broken module.
- **A repeat username is a return, not a conflict.** Same participant: the password
  is reset and shown again. Different participant: rejected. Recovery and conflict
  are one code path, which is the whole of "I closed the tab".
- The portal assigns **Global Admin**, as the identity matrix already specifies —
  students must see namespaces their platform's service account created, and
  challenge 5 depends on it.
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
`workshop-creds init --username <name>` — which is why it also works on a laptop
where no participant id exists. The sandbox prints a **bare join link**; the portal
issues the personalised, HMAC-signed one back, and that URL is the thing a student
bookmarks and the recovery path they return through.

Workshop state — which username, which cohort — is stored as **Authentik user
attributes** through its API. No second datastore, and nothing writes Authentik's
schema behind its back, because Authentik migrates on every upgrade.

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

The domain is needed only as an identifier namespace and for the IdP-domain mapping
support asks for. **No MX, no SPF, no DKIM, no mailbox.**

---

## Sandbox

`n1-standard-4`, 16 GB, k3s. The portal's build already needs this for uv plus
Docker plus code-server; this one drops Prometheus and Grafana but adds a Go
toolchain, k3s and Vault.

Prebuilt aggressively:

- Go toolchain; `uv sync` complete
- `terraform` plus a **warm provider plugin cache** — a cold `terraform init`
  against `temporalio/temporalcloud` is a silent two-minute stall on challenge 1
- Vault binary
- k3s installed, **not started**
- The managed worker image **built and imported into k3s's image store**

k3s over k3d **in the sandbox**: the Kubernetes-auth switch in challenge 4 is more
honest against a real kubelet, and nothing is torn down repeatedly. Measure the
boot rather than guessing — the portal's loading messages exist because that build
is already slow.

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
| Challenge 2 peak | 1 | 1 | 1 | **3** |
| Challenge 5 peak | 1 | 1 | 1 | **3** |

15 × 3 = **45 of 50**, five spare. That headroom is not slack, it is insurance
against a specific failure: a student who skips challenge 3's environment removal
and reaches challenge 5 holds **four**. Five spare absorbs five of them. Sixteen
students would leave room for two, and the third straggler's failure lands on
whoever applies next — not on the student who skipped, which makes it the worst
kind of bug to debug in a room.

Three mechanisms hold the peak at three, and all of them are needed:

1. **Challenge 3's environment removal is graded and mandatory.** It is what
   returns a student to two before challenge 5 adds one.
2. **Challenge 5 provisions a single environment** — `--environments staging`. The
   stopwatch and the "you provisioned it yourself" beat both survive; a new team's
   first ask is rarely both environments anyway.
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

So **slots are retired**, along with `SlotPoolWorkflow`, `nsctl slot` and the
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
5. **Five namespaces of headroom.** 15 students × 3 is 45 of 50. A student who
   skips challenge 3's removal and reaches challenge 5 holds four, and five such
   stragglers exhausts the margin. The graded removal and the reconciler's quota
   pre-check are what keep this theoretical. **A sixteenth attendee does not fit.**
6. **Single-machine state service.** Mitigated by `AttemptImport`, but a Fly deploy
   mid-workshop will fail somebody's apply.
7. **Sandbox boot time** is unmeasured and the prebuild list is long.
8. **Authentik becomes the access control plane.** Between cohorts, standing Global
   Admin users sit in the account gated only by Authentik — an IdP we now operate.
   A misconfigured tenant is a live-credential problem, not an inconvenience. The
   instructor teardown script is the mitigation, and it has to actually be run.

*Resolved since the first draft:* whether a pre-created, never-accepted user can
complete a SAML login without opening the invitation email. It can. The no-mail
design is no longer contingent.
