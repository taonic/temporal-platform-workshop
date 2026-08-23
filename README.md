# Temporal Platform Workshop

A control plane for Temporal Cloud, built as a five-challenge workshop.

A CLI asks four questions and writes a spec. A Temporal entity workflow reads the
spec and makes it true — namespaces, least-privilege identities, credentials in
Vault. A decorator in the application code declares a task queue, and the platform
generates the worker config, the image and the Kubernetes manifest from it.

> Temporal makes durable execution possible; the platform path makes it repeatable.
> — *OpenAI @ Replay 2026*

The design and its reasoning are in **[DESIGN.md](DESIGN.md)**. Read that first if
you want to know *why* rather than *what*.

## Layout

```
cmd/nsctl/            the front door: wizard, apply, sync, status, worker, slot, reap
cmd/platform-worker/  the control plane: hosts the reconciler and the activities
internal/platform/    workflows and activities -- the reconciler lives here
internal/tfexec/      terraform subprocess, pluggable state backend, no locking
internal/tfworkspace/ embedded module -> scratch dir -> apply -> throw away
internal/cloudops/    Cloud Ops API, for the things Terraform must not do
internal/vaultkv/     Vault: source of the platform's key, sink for minted keys
internal/spec/        the namespace spec. Never leaves Go
internal/workerconfig/the one contract that crosses the language seam
terraform/namespace/  the module. Note what is absent: the API key
worker/               the managed worker (Python) -- product-side code
schema/               worker config JSON Schema, validated by both languages
specs/                desired state. Committing here is how you ask for something
services/state/       terraform http state backend, deliberately lock-free (see its README)
instruqt/             sandbox prebuild and the five challenges
hooks/post-commit     delivers intent to the reconciler the moment it exists
```

Go for the platform, Python for the product. The seam falls on the boundary the
workshop is teaching, not in an arbitrary place.

## The labs

Five files are prose stubs. A student writes them; everything else is provided.

| File | Challenge | What it teaches |
|---|---|---|
| `terraform/namespace/main.tf` + `outputs.tf` | 1 | The module, and why `temporalcloud_apikey` is not in it |
| `internal/platform/environment.go` | 2 | The child workflow, and what a return value costs you |
| `internal/platform/wait.go` | 3 | Signals carry intent; the timer catches reality |
| `worker/workflows/greeting.py` | 4 | The decorator is the declaration |

That ratio follows the training portal, which asks students to write **HCL** and
hands them working Python to run — a deliberate choice about where a learner is
allowed to fail. The two Go stubs are the exception, because the reconciler's wait
and the fan-out child are the best lessons in the repo and reading them is not the
same as writing them.

Go stubs return a non-retryable error rather than panicking, so the message reaches
you through the parent workflow, the CLI and the Temporal UI instead of being
swallowed. `_stubs/` starts with an underscore because the Go toolchain ignores such
directories — otherwise `go build ./...` would compile two copies of package
`platform`.

**The answers live in the portal**, as the snippets students read on each lab page —
there is no solutions directory, so there is only ever one copy of an answer.
`make solve` emits those snippets into the tree, which is how the answer key gets
compiled and tested: a snippet that stops working fails CI rather than a student's
paste.

```bash
make test        # labs 2 and 3. Fails on a fresh clone, on purpose
make lab-test    # lab 4. Same
make py-test     # contract tests only: schema and golden fixture. Always green
make solve       # emit the portal's snippets into the tree
make unsolve     # put the stubs back
make verify      # solve, build, test, validate, unsolve. This is what CI runs
```

`make verify` matters more than it looks, and more than it used to. The answers are
now TypeScript string literals in the portal, and nothing else in the world compiles
a string literal — so this is the only thing standing between a provider bump and
five snippets that no longer work. It needs `pnpm install` in `portal/`.

## Run it locally

You need Go 1.25+, Python 3.12+, `uv`, Terraform, Vault and the Temporal CLI.

```bash
make build

# 1. A Temporal for the control plane to run on
temporal server start-dev &

# 2. Vault, holding the platform's own Cloud API key
vault server -dev -dev-root-token-id=dev &
export VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=dev
vault kv put secret/platform/cloud-api-key api_key="$TEMPORAL_CLOUD_API_KEY"

# 3. Terraform state. Local is fine for one machine
export STATE_DIR=.platform-state

# 4. The control plane
./bin/platform-worker &

# 5. Use it
./bin/nsctl new
./bin/nsctl apply -f specs/<name>.yaml
```

For the declarative path, `git config core.hooksPath hooks`, then commit a spec and
watch `nsctl status <name>`.

## Web services

Two, both on Fly and both operated by the instructor:

- **`portal/`** — Next.js + TypeScript. Lab material with per-student names, live
  checkpoints, and an `/instructor` cohort view. See
  [portal/README.md](portal/README.md).
- **`services/state/`** — the Terraform HTTP state backend. See
  [services/state/README.md](services/state/README.md).

The portal reads the **Cloud account**, not the students' control planes: each
sandbox runs its own dev server and nothing central has ingress to it. That is why
the reconciler stamps `participant` and `drift-corrected-at` into namespace tags —
`Namespace.tags` is readable through the Ops API, so tags are the one channel
through which progress escapes a sandbox.

Whatever exists only inside a sandbox — a pod on k3s, a secret in Vault, a completed
workflow — is marked **self-attested** in the portal and graded by that challenge's
Instruqt check instead. The two graders are complementary by construction, and the
page says which is which.

The invite flow the training portal needed is gone entirely: SAML authenticates
students against an Okta tenant.

## Test

```bash
make verify       # everything, against the solutions. Start here
make lint
make tf-validate
```

`worker/tests/fixtures/worker-config.json` is read by both a Go test and a Python
test. If the two sides ever disagree about the contract, one of them fails before
anything reaches a cluster.

## Three rules worth knowing before you read the code

**The workflow id is the resource identity, so Temporal is the lock.** One child
workflow per resource, keyed on the resource's name. Temporal refuses two
executions with the same id, so there is a single writer per state file by
construction — no lock table, no lease, no `terraform force-unlock`. Which is why
`services/state` implements no `LOCK` endpoint and says so when you ask it.

**Credentials never pass through Terraform.** `temporalcloud_apikey` exposes
`.token` as a readable attribute, and `sensitive = true` masks CLI output without
encrypting state. So keys are minted through the Cloud Ops API in a separate
activity that writes to Vault and returns a *path*. Nothing sensitive in state,
nothing sensitive in event history, and rotation stops being state surgery.

**Config is generated from code, so it cannot drift.** The decorator is the source
of truth for which queue a workflow runs on; `gen-config` reads the live registry;
the worker re-checks the config against that registry on boot and exits non-zero if
they disagree. Not a warning — a warning in a pod's logs is a warning nobody reads.

## What this deliberately does not do

The Go proxy from the talk (a week of work teaching gRPC interception, not platform
design). A Kubernetes operator (the point is that a workflow is the better control
loop). Terraform state locking (the absence *is* the lesson). SCIM, worker
versioning, groups, Nexus. Each one is a decision with a reason — they are listed
with those reasons in [DESIGN.md](DESIGN.md#deliberate-non-goals).
