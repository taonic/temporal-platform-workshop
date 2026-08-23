---
slug: the-paved-road
id: 04
type: challenge
title: The paved road
teaser: A decorator declares a task queue. The platform does everything else.
notes:
  - type: text
    contents: |-
      "The product team only thinks about the application code. The rest is the
      platform team's." That sentence is the whole talk, and this challenge is
      where you build the mechanism behind it.

      One decorator. Config generated from the code, so it cannot drift. A manifest
      generated from the config. And a credential that arrives through Kubernetes
      auth, because the token that worked from your shell does not exist in a pod.
tabs:
  - id: terminal
    title: Terminal
    type: terminal
    hostname: platform-workshop
    workdir: /workspace/platform
  - id: editor
    title: Editor
    type: code
    hostname: platform-workshop
    path: /workspace/platform
  - id: temporal
    title: Temporal UI
    type: service
    hostname: platform-workshop
    port: 8233
difficulty: advanced
timelimit: 5400
---

Take the platform hat off for a moment. You are the product team now.

### 1. Write the workflow

Open `worker/workflows/greeting.py`. Write an activity and a workflow, each
declaring where it runs via the decorator.

```bash
cd worker && uv run pytest -m lab
```

Then read the list in that file of what you did **not** have to write: no namespace
plumbing, no task-queue constant duplicated into a deployment file, no API key, no
client construction, no Dockerfile, no manifest. That list is the paved road.

### 2. Generate the config from the code

```bash
nsctl worker gen-config --out generated/worker-config.json
cat generated/worker-config.json
```

Nothing in that file was hand-written. The queues came from your decorators; the
owner and service name came from your spec. **Config generated from code cannot
drift from code.**

Note that `nsctl` shelled out to Python. It has to: the decorators live in Python,
so only Python can introspect them. Reimplementing that in Go would create a second
source of truth that silently disagrees with the first. The CLI is a user
interface, not a place where logic lives.

### 3. Break it on purpose

Comment out the import in `worker/workflows/__init__.py` and run the worker:

```bash
cd worker && uv run python -m platform_sdk.main --config ../generated/worker-config.json
```

It refuses to start and names exactly what is missing. **Not a warning** — a
warning in a pod's logs is a warning nobody reads, and the failure it hides is a
workflow that starts, gets scheduled, and is never picked up. This is the failure
OpenAI's platform team calls out by name: *"always register that workflow at
bootstrap; often times people miss that."* Put the import back.

### 4. Deploy it

```bash
sudo systemctl start k3s
nsctl worker manifest -c generated/worker-config.json \
  --image platform-worker:dev -o deploy/orders-staging-worker.yaml
sudo k3s kubectl apply -f deploy/orders-staging-worker.yaml
```

Read the manifest before you apply it. There is no credential in it, and none in
the image. Just `VAULT_K8S_ROLE` and a path.

### 5. Switch Vault to Kubernetes auth

Your pod will crash-loop, and it should: `VAULT_TOKEN` does not exist in there. This
is the one moment where "the worker moved into the cluster" has a consequence you
have to handle rather than watch.

```bash
vault auth enable kubernetes
vault write auth/kubernetes/config kubernetes_host="https://$(hostname -i):6443"
vault policy write worker-orders - <<POLICY
path "secret/data/namespaces/$WORKSHOP_PARTICIPANT/orders/*" { capabilities = ["read"] }
POLICY
vault write auth/kubernetes/role/worker-orders \
  bound_service_account_names=orders-staging-worker \
  bound_service_account_namespaces=default \
  policy=worker-orders ttl=1h
```

Fifteen lines of config, and the worker now authenticates as *itself*.

```bash
sudo k3s kubectl logs -l app=orders-staging-worker --tail=20
```
