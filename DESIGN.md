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
    Okta tenant     — SAML IdP. 15 fixed slot-bound identities. No mail anywhere
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

Seven rules carry the design. Each one is a lesson as much as an implementation
choice.

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
Admin, so the platform SA cannot do it. The alternative — an elevated
account-admin credential inside the reconcile path — would reintroduce exactly the
second credential the portal deliberately deleted from its `providers.tf`.

Students authenticate by SAML against an Okta tenant rather than an emailed invite
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
   *Graded:* Query the reconciler for a drift-corrected result.

4. **The paved road.** A decorated workflow declares its own queue and namespace;
   `gen-config` emits worker config; `nsctl` templates the manifest; the worker
   lands on k3s. Vault auth switches from root token to Kubernetes auth as a graded
   step — the one moment where "the worker moved into the cluster" has a consequence
   the student must handle rather than observe.
   *Graded:* worker pod healthy, polling the right queue in the right namespace.

5. **Be the developer.** New persona, empty directory, **stopwatch**. From nothing
   to a completed workflow using only the platform you built. Then ten minutes on
   why OpenAI abandoned Terraform for an operator, and what a Temporal-based control
   loop gets right that a k8s controller cannot.
   *Graded:* a workflow completed in the provisioned namespace within N minutes of
   the challenge starting.

Challenge 4 is the fattest and least forgiving — every failure there is a container
failure rather than a platform lesson. Mitigation: the worker image is **pre-built
and pre-imported into k3s** during sandbox provisioning, so the challenge is
configuration and deployment, not `docker build`.

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

### Identity via SAML

**No mail anywhere in this design.** Students authenticate against an **Okta
developer tenant** configured as the account's SAML IdP. Temporal still sends an
invitation email when the user is created; nobody ever reads it.

This also dissolves the constraint that motivated a relay in the first place — one
email address maps to one Temporal Cloud account permanently, so a platform
engineer whose work address already sits in another account is un-invitable. Under
SAML the address is a workshop-owned identifier, not their real mailbox.

- **15 fixed identities**, `student-NN@<domain>`, **bound to the slot pool**. Slot 7
  owns `ws-7-staging`, `ws-7-prod` and `student-07@<domain>`. One lease derives
  everything, and identities are reused across cohorts rather than recreated.
- Provisioned with `temporalcloud_user` in Terraform — pleasingly on-thesis: the
  workshop's own attendee identities are provisioned as code.
- **Okta is the kill switch.** The reaper deactivates the Okta user, which is
  instant and needs no Cloud API call. Cloud user records persist between cohorts.
- **SCIM is not needed.** Fifteen fixed identities provisioned once do not need
  lifecycle sync, and SCIM is Enterprise-tier or a $500/month Business add-on.
- Ask support to **disable social logins** on the account, so there is exactly one
  login path and nobody lands on "Continue with Google".
- Okta developer edition over Entra ID (which gates SAML for custom apps behind a
  paid tier) and over Google Workspace (whose Temporal setup instructions are still
  being written).

The domain is needed only as an identifier namespace and for the IdP-domain mapping
support asks for. **No MX, no SPF, no DKIM, no mailbox.**

**This design is contingent on one unverified claim.** Temporal support has stated
that JIT account creation is *not* supported, so users must be created before they
can sign in — that part is fine, the control plane creates them. What is *not* yet
confirmed is whether a created-but-never-accepted user can complete a SAML login
without opening the invitation email. Ask before building; if acceptance turns out
to be required, the mail relay returns. See *Risks*.

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

k3s over k3d: the Kubernetes-auth switch in challenge 4 is more honest against a
real kubelet, and nothing is torn down repeatedly. Measure the boot rather than
guessing — the portal's loading messages exist because that build is already slow.

---

## Numbers, quotas and lead times

| Item | Value | Note |
|---|---|---|
| Students | 15 | |
| Namespaces per student | 2 | staging + prod, one region |
| **Namespace quota to request** | **40** | Default is 10. The portal needed a support ticket two weeks ahead |
| Cloud metrics budget | 180 req/hour **per account** | Largely moot — `metrics_endpoint` is out of scope |
| Okta developer tenant | 1, free | 15 fixed identities, reused across cohorts |

**Name recycling.** Temporal Cloud reserves namespace names after deletion, so
names must not be derived from participant IDs — a naive scheme burns names
permanently. Physical names are `ws-<slot>-<env>`, where `slot` is a small integer
**leased from a pool workflow.** Slot 7 is reused by design, so
reserved-after-deletion stops mattering.

**Reaping.** A reaper workflow — not a script — keyed to the participant ID, holding
a TTL, accepting the same `extendMs` and `revoke` signals the portal's `invitation`
workflow already has. Self-paced arrivals overlap unpredictably; abandoned sandboxes
must return their slots to the pool.

### Critical path — start now

1. **SAML enablement.** SSO is **not self-service**: the ticket must carry the IdP
   sign-in URL, the X.509 certificate in PEM, and the IdP domain to map. Fold three
   more asks into the same ticket — disable social logins, confirm the acceptance
   question above, and the namespace quota. Plan coverage is confirmed.
2. **Namespace quota for 40.** Weeks of lead time; same ticket.
3. **Okta developer tenant and the domain.** Free, self-service, and the only
   critical-path item entirely under your control.

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
| SCIM | Fifteen fixed identities provisioned once need no lifecycle sync; Enterprise-tier or a $500/month add-on |

---

## Open risks

1. **Challenge 4 remains the fattest slot** even with the image pre-built. Watch it
   in the first dry run; the fallback is splitting it across 4 and 5, which costs
   the stopwatch.
2. **Students hold Global Admin.** Same blast radius the portal already accepts
   (its sharp edges #4 and #6), mitigated by slot names and the reaper. A griefing
   student can delete another's namespaces.
3. **Single-machine state service.** Mitigated by `AttemptImport`, but a Fly deploy
   mid-workshop will fail somebody's apply.
4. **Sandbox boot time** is unmeasured and the prebuild list is long.
5. **One unverified assumption gates the whole identity design.** Whether a
   pre-created, never-accepted user can complete a SAML login without opening the
   invitation email is unconfirmed. Ask first. If the answer is no, the mail relay
   returns and Google Workspace rejoins the critical path.
6. **Okta becomes the access control plane.** Between cohorts, 15 standing Global
   Admin users sit in the account gated only by Okta. A misconfigured tenant is a
   live-credential problem, not an inconvenience.
