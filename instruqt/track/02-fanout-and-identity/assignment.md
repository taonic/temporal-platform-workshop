---
slug: fanout-and-identity
id: 02
type: challenge
title: Fan-out and identity
teaser: One logical spec, two physical namespaces, two least-privilege identities.
notes:
  - type: text
    contents: |-
      OpenAI runs about 700 namespaces from a couple of hundred logical names.
      A team asks for `orders`; the platform creates one namespace per region per
      environment. Fan-out is the most platform-shaped idea in their talk.

      Here it is two environments in one region — enough to teach spec fan-out,
      per-environment identity, and the thing people forget: partial failure.
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
difficulty: intermediate
timelimit: 3600
---

One spec, two namespaces. Look at how that happens:

- `NamespaceWorkflow` / `ProvisionWorkflow` is the parent — it owns the plan.
- `EnvironmentWorkflow` is a child, one per environment — it owns *one resource*.

Read `internal/platform/environment.go` and find `EnvironmentWorkflowID`. That
function is the keystone of the entire design.

### The lock you did not have to build

The child's workflow id **is** the resource identity: `ns-orders-staging`. Temporal
refuses to run two workflows with the same id, so you get a single writer per
resource for free. No lock table. No lease. No `terraform force-unlock` runbook.

Which is why the state service has no lock endpoints at all. Go and ask it:

```bash
curl -s -X LOCK -u "$WORKSHOP_PARTICIPANT:$STATE_TOKEN" \
  "$STATE_SERVICE_URL/state/$WORKSHOP_PARTICIPANT/<name>/staging"
```

Then prove the lock is real. While an apply is running, try to start the same child
again:

```bash
temporal workflow start --type EnvironmentWorkflow --task-queue platform-control-plane \
  --workflow-id ns-<name>-staging --input '{}'
```

### Least privilege, and how little it needs

Look at `terraform/namespace/main.tf`. The worker's service account is
`namespace_scoped_access` with `write` — no account-level access at all. A worker
polls a task queue and completes tasks; it never calls the Ops API.

Now the part worth remembering. The identity your **platform** runs as holds the
**Developer** role, not Global Admin. Developer can create namespaces and receives
Namespace Admin on the ones it creates — and Namespace Admin is exactly what is
needed to manage namespace-scoped service accounts, mint their keys and set tags.

You are holding Global Admin right now because this is a workshop and you need to
see everything. Your platform holds Developer, because that is what production
looks like. Notice that it was enough.

### Partial failure

Break one environment on purpose — set an impossible region for `prod` in the spec
and re-apply. Staging succeeds; prod fails; you get both results. A platform that
collapses that into one error is lying to whoever is on call.
