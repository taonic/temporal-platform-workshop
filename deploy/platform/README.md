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
make base-up                               # k3s, vault, kubernetes auth, seed the key
unset TEMPORAL_CLOUD_API_KEY

# The student. No credential needed -- the pod authenticates to Vault as its
# ServiceAccount. First, apply terraform/namespace by hand to make the
# control-plane namespace, then:
export CONTROL_NAMESPACE=ws-<username>-control.<acct>
export TEMPORAL_ADDRESS=us-west-2.aws.api.temporal.io:7233
make platform-up
make logs
```

`make up` still runs both, for a one-person test. On a Mac you need a cluster
first:

```bash
k3d cluster create platform -p "30820:30820@server:0"
```

The port mapping matters because Vault runs in the cluster while the `vault` CLI
runs on the host — every challenge has students read secrets by hand.

NodePort routing is not universal, so `up.sh` probes it and falls back to a
`kubectl port-forward` on the same port:

| Runtime | NodePort reaches the host? |
|---|---|
| k3s (the sandbox) | yes — the host *is* the node |
| k3d | only with `-p "30820:30820@server:0"` |
| Docker Desktop (kind-based, node `desktop-control-plane`) | **no**, ever |

Either way `VAULT_ADDR` is `http://127.0.0.1:30820` everywhere, which is the point
— one address in the lab text, the env file and every `vault kv get`. If the
forward dies, `make vault-forward` restarts it.

## Two surfaces, one rule

**Everything a student types is `make <verb>`** — `make` on its own lists them.
The single exception is `./scripts/workshop-creds`, which wraps arbitrary commands
and prompts; Make can express neither.

`deploy/platform/up.sh` and `scripts/workshop-check` are implementation. Make calls
them; no lab names them. And every Make recipe is one or two lines — anything with
branching or a multi-line message lives in `up.sh`, because Make runs each recipe
line in its own shell and backslash-continued conditionals there have already
produced two silent bugs.

## make check

`make check` probes tools, cluster, Vault, egress and the control plane, and is the
first step of challenge 1.

It runs every probe rather than stopping at the first failure, and separates
**warn** (not built yet — the expected state before challenge 1) from **FAIL**
(broken). Exits non-zero only on FAIL, so CI can use it.

## workshop-creds

`scripts/workshop-creds` fills in the Terraform variables the bootstrap needs and
hands the Cloud key to one command at a time.

Run it by path from the repo root, in the sandbox and on a laptop alike — nothing
to install, nothing on `PATH`. `env-file` prints where it wrote, since that path
differs between environments and the lab text must not.

```bash
./scripts/workshop-creds init --username me   # TF_VAR_* for the bootstrap apply
./scripts/workshop-creds exec -- terraform -chdir=terraform/namespace apply
./scripts/workshop-creds control   # read namespace_id from state -> CONTROL_NAMESPACE
./scripts/workshop-creds show      # everything it set, none of it secret
./scripts/workshop-creds env-file  # where it writes
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
make reload      # build image, import, rollout restart, wait
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
