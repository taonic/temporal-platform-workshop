# The k3s + Temporal Cloud experiment

Branch `k3s-cloud`. Everything long-running is a pod; the only host process is
k3s. There is no `temporal server start-dev` — the control plane runs against a
Temporal Cloud namespace.

## What runs where

| | on `main` | here |
|---|---|---|
| Temporal | `temporal server start-dev &` | Temporal Cloud namespace |
| Vault | `vault server -dev &` | pod, NodePort 30820 for the host CLI |
| platform-worker | systemd unit | Deployment |
| managed worker | k3s, from challenge 4 | unchanged |
| k3s | stopped until challenge 4 | up from provision |

## Bootstrap

The thing that provisions namespaces has to run somewhere before it can provision
anything, so one control-plane namespace is made by hand -- with the same module
the platform later runs, applied directly. That is challenge 1's first move, and
it is the only namespace in the workshop a person creates.

Two phases, because they have different owners:

```bash
# Provisioning. The only step that holds the Cloud key in an environment
# variable; unset it afterwards, as the sandbox does.
export TEMPORAL_CLOUD_API_KEY=...          # Developer role
./scripts/workshop base-up                               # k3s, vault, kubernetes auth, seed the key
unset TEMPORAL_CLOUD_API_KEY

# The student. No credential needed -- the pod authenticates to Vault as its
# ServiceAccount. First, apply terraform/namespace by hand to make the
# control-plane namespace, then:
./scripts/workshop platform-up          # reads the namespace from Terraform
./scripts/workshop logs

# platform-up brings Vault and the Kubernetes auth up itself if they are missing,
# so a rebuilt cluster needs no separate base-up -- only the Cloud API key has to
# be seeded again, because a fresh Vault is an empty one:
#   ./scripts/workshop init --api-key
```

`./scripts/workshop up` still runs both, for a one-person test. On a Mac you need a
cluster first:

```bash
k3d cluster create platform -p "30820:30820@server:0"
```

The port mapping matters because Vault runs in the cluster while the `vault` CLI
runs on the host — every challenge has students read secrets by hand.

**Docker Desktop's own Kubernetes is not always a substitute.** Recent versions
provision it with kind: the node is called `desktop-control-plane` and runs its own
containerd, so an image from `docker build` never reaches the kubelet, and the node
lives inside the Docker Desktop VM where neither `docker exec … ctr images import`
nor `kind load` can reach it. The older kubeadm provisioning (node `docker-desktop`)
does share the daemon and works fine. `workshop check` tells the two apart and says
which you have; `platform-up` refuses rather than deploying something that can only
end in `ImagePullBackOff`.

## Configuration

Everything per-student lives in one ConfigMap, `platform-env`, built by
`up.sh`. **Its keys are the environment variable names the worker reads**, and the
Deployment consumes the whole map with `envFrom` rather than naming keys one at a
time. Adding a setting is therefore one line in `up.sh` and nothing in the
manifest — there is no second list to forget.

| Key | From | Default |
|---|---|---|
| `TEMPORAL_ADDRESS` | derived from the region at `workshop init` | `us-west-2.aws.api.temporal.io:7233` |
| `TEMPORAL_NAMESPACE` | Terraform's `namespace_id` output | none — `platform-up` refuses without it |
| `WORKSHOP_USERNAME` | `workshop init --username` | `local` |
| `WORKSHOP_COHORT` | `workshop init --cohort` | `local` |
| `PLATFORM_NAMESPACE_QUOTA` | environment, if set | `50`, in Go |

Defaults are written in exactly one place: `ConfigFromEnv` in
`internal/platform/activity/config.go`. An empty ConfigMap value counts as unset —
`env()`, `envInt()` and `envDuration()` all fall through to the default — so this
script never has to guess a value in order to pass one.

Three variables are deliberately *not* in the ConfigMap: `VAULT_ADDR`,
`VAULT_K8S_ROLE` and `STATE_DIR` are pinned in the Deployment's own `env:` block.
They describe where the pod runs rather than who it runs for, and because `env`
takes precedence over `envFrom`, a stray ConfigMap key cannot quietly repoint the
worker at another Vault or another state directory.

### Where the control-plane namespace comes from

`workshop platform-up` reads it from `terraform output -raw namespace_id` in
`terraform/namespace` — the Terraform that created it — falling back to reading
the state file directly when `terraform init` has not been run there. Nothing has
to be exported and nothing has to be kept in sync.

`init` deliberately does **not** write it. `init` runs before challenge 1's apply,
so any value it wrote would be a prediction of a namespace that does not exist
yet; and deriving the account id needs the key in Vault, which needs a `VAULT_ADDR`
that lives in the very file `init` is still writing. Terraform knows what was
actually created, which is the question being asked.

Precedence, when you need to override:

1. `--control-namespace <ns>` — always wins
2. `$CONTROL_NAMESPACE` — an escape hatch; nothing writes it any more. If it
   disagrees with Terraform, `platform-up` says so rather than silently choosing
3. Terraform's output — the normal path

The Cloud API key is in none of this. The pod authenticates to Vault as its
ServiceAccount and reads the key at runtime — see rule 2 in `DESIGN.md`.

NodePort routing is not universal, so `up.sh` probes it and falls back to a
`kubectl port-forward` on the same port:

| Runtime | NodePort reaches the host? |
|---|---|
| k3s (the sandbox) | yes — the host *is* the node |
| k3d | only with `-p "30820:30820@server:0"` |
| Docker Desktop (kind-based, node `desktop-control-plane`) | **no**, ever |

Either way `VAULT_ADDR` is `http://127.0.0.1:30820` everywhere, which is the point
— one address in the lab text, the env file and every `vault kv get`. If the
forward dies, `./scripts/workshop vault-forward` restarts it.

## Two surfaces, one rule

**Everything a student types is `./scripts/workshop <verb>`** — run it on its own
to list them. Make targets are reachable through it, so there is one entry point.
The single exception is `./scripts/workshop`, which wraps arbitrary commands
and prompts; Make can express neither.

`deploy/platform/up.sh` and `scripts/workshop-check` are implementation. Make calls
them; no lab names them. And every Make recipe is one or two lines — anything with
branching or a multi-line message lives in `up.sh`, because Make runs each recipe
line in its own shell and backslash-continued conditionals there have already
produced two silent bugs.

## workshop check

`./scripts/workshop check` probes tools, cluster, Vault, egress and the control
plane, and is the first step of challenge 1.

It runs every probe rather than stopping at the first failure, and separates
**warn** (not built yet — the expected state before challenge 1) from **FAIL**
(broken). Exits non-zero only on FAIL, so CI can use it.

## workshop-user-delete

Removes one student from **both** Temporal Cloud and Authentik, by email:

```bash
./scripts/workshop-user-delete tao@temporal.workshop            # dry run
./scripts/workshop-user-delete tao@temporal.workshop --confirm
```

For repairing a single account rather than clearing a cohort — `workshop-teardown`
does that. The case it exists for is a join that half-failed and left an Authentik
user with no Cloud user behind it: the name is taken, rejoining hits the returning
path, and deleting both sides is the clean way back.

Each side is attempted independently and reports missing/present separately,
because the states worth repairing are exactly the asymmetric ones.

## workshop

`scripts/workshop` fills in the Terraform variables the bootstrap needs and
hands the Cloud key to one command at a time.

Run it by path from the repo root, in the sandbox and on a laptop alike — nothing
to install, nothing on `PATH`. `env-file` prints where it wrote, since that path
differs between environments and the lab text must not.

```bash
./scripts/workshop init --username me   # TF_VAR_* for the bootstrap apply
./scripts/workshop exec -- terraform -chdir=terraform/namespace apply
# CONTROL_NAMESPACE comes from `workshop init`, which reads the account id out of
# the API key's own claims.
./scripts/workshop show      # everything it set, none of it secret
./scripts/workshop env-file  # where it writes
```

Every value falls back from an argument, to the environment, to a prompt — so
Instruqt drives it non-interactively with `--username` from the portal, and a
laptop gets asked. It writes to `/etc/workshop/env` when running as root and
`~/.workshop-env` otherwise; `WORKSHOP_ENV_FILE` overrides both.

It deliberately does **not** persist `TEMPORAL_CLOUD_API_KEY`, which is where it
departs from the training portal's version. The key lives in Vault; `exec` gives
it to a single process.

## The inner loop

**Every one of challenges 1, 2 and 3 edits something compiled into the worker** —
the Terraform module included, because `terraform/embed.go` embeds it. An edit is
not live until the image is rebuilt and the Deployment restarted:

```bash
./scripts/workshop reload      # build image, import, rollout restart, wait
```

It refuses to start until the cluster is reachable and the control plane is
deployed, because the alternative is a forty-second build followed by an
inscrutable error. Image import handles three runtimes: k3s (`ctr images
import`), k3d (`k3d image import`), and Docker Desktop, which shares the Docker
daemon and needs no import at all.

This is the cost of the experiment and the thing to judge it on. On `main` the
equivalent is `go build && systemctl restart`, which is roughly two seconds
against roughly forty.

## Open questions this does not answer

1. **Quota.** 15 students × (control + staging + prod) is 45 namespaces against a
   requested quota of 40. Either the ask goes up, or the control plane is one
   namespace shared by the cohort.
2. **Sharing breaks rule 1.** A shared control namespace means `ns-<name>`
   reconciler IDs collide between students, and a shared task queue means one
   student's half-written `wait.go` executes another's reconciler. Both need
   slot-prefixing before sharing is safe.
3. ~~The slot pool~~ — **resolved.** Slots are retired entirely: names derive from
   the username a student chooses at the join screen, and there is nothing to
   lease. See DESIGN.md, *Names are recyclable*.
4. **Challenge 4 loses its opening move.** `sudo systemctl start k3s` is a graded
   step today, and k3s is up from provision here.
5. **The Temporal UI tab.** The Instruqt `service` tab on port 8233 has nothing to
   point at; students would use cloud.temporal.io instead.
