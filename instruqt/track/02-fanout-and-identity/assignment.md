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

One spec, two namespaces. The parent workflow already fans out one child per
environment and collects the results. **The child is missing.**

### 1. Read the id, then write the body

Open `internal/platform/environment.go`. Read `EnvironmentWorkflowID` first — it is
done for you, and it is the keystone of the entire design.

The child's workflow id **is** the resource identity: `ns-orders-staging`. Temporal
refuses to run two workflows with the same id, so you get a single writer per
resource for free. No lock table. No lease. No `terraform force-unlock` runbook.

Now write `EnvironmentWorkflow`. The comment above it tells you the three steps and
the one decision that matters.

```bash
go test ./internal/platform/...
```

`TestProvisionWorkflowFansOutPerEnvironment` and
`TestProvisionWorkflowReportsPartialFailure` are your feedback loop. Make them pass
before you touch the Cloud.

The decision is step 4 — what you return. Look at `MintKeyResult`: a path and an
id, no token. Whatever a workflow returns is written to its event history, readable
by anyone who can see the workflow, for the whole retention period. A credential in
a return value is a credential in an audit log you cannot redact.

### 2. Prove the lock is real

Deploy it, then while an apply is running, try to start the same child again:

```bash
temporal workflow start --type EnvironmentWorkflow --task-queue platform-control-plane \
  --workflow-id ns-<name>-staging --input '{}'
```

And ask the state service for a lock:

```bash
curl -s -X LOCK -u "$WORKSHOP_PARTICIPANT:$STATE_TOKEN" \
  "$STATE_SERVICE_URL/state/$WORKSHOP_PARTICIPANT/<name>/staging"
```

### 3. Least privilege, and how little it needs

The service account you wrote in lab 1 is `namespace_scoped_access` with `write` —
no account-level access at all. A worker polls a task queue and completes tasks; it
never calls the Ops API.

Now the part worth remembering. The identity your **platform** runs as holds the
**Developer** role, not Global Admin. Developer can create namespaces and receives
Namespace Admin on the ones it creates — and Namespace Admin is exactly what is
needed to manage namespace-scoped service accounts, mint their keys and set tags.

You hold Global Admin right now because this is a workshop and you need to see
everything. Your platform holds Developer, because that is what production looks
like. Notice that it was enough.

### 4. Break one environment

Set an impossible region for `prod` in the spec and re-apply. Staging succeeds, prod
fails, and you get both results. A platform that collapses that into one error is
lying to whoever is on call.
