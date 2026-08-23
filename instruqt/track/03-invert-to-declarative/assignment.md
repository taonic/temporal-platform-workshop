---
slug: invert-to-declarative
id: 03
type: challenge
title: Invert to declarative
teaser: Same activities, new driver. Then change something behind the platform's back.
notes:
  - type: text
    contents: |-
      OpenAI built their control loop as a Kubernetes operator, because that is
      what they had. You are about to build the same loop as a Temporal entity
      workflow — which is a strictly better operator for the job: durable by
      construction, retryable per resource, auditable from event history, and able
      to wait on a human without holding a process open.

      This challenge is the workshop's central claim, made executable.
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
timelimit: 4500
---

The reconciler exists. It has the loop, the reconcile, the drift check and the
query handler. It is missing the four lines that decide what it reacts to.

### 1. Write the wait

Open `internal/platform/wait.go` and write `waitForNext`. Block until one of three
things happens — a spec arrives on `applyCh`, a destroy arrives on `destroyCh`, or
`after` elapses — and say which.

Use `workflow.NewTimer` and `workflow.NewSelector`. Not a Go `select`, not
`time.After`: neither is deterministic, and a replay would diverge from the
recorded history.

```bash
go test ./internal/platform/...
```

`TestReconcilerDetectsAndCorrectsDrift` proves the timer half.
`TestReconcilerIgnoresAnApplyThatChangesNothing` proves the signal half. Nothing
else in the reconciler needs changing — inverting an imperative script into a
control loop is a change of driver, not a rewrite.

### 2. Deliver intent by committing

```bash
git add specs && git commit -m "ask for a namespace"
```

The `post-commit` hook ran `nsctl sync`, which does `signal-with-start` on
`ns-<name>`. First commit creates the reconciler; every later commit signals the one
that already exists. **One entity workflow per logical namespace, for its whole
life.**

`nsctl sync` did not wait. Intent has been delivered; convergence is the
reconciler's problem. That difference from `nsctl apply` is this whole challenge.

```bash
nsctl status <name>
```

### 3. Change nothing, and watch nothing happen

Commit an unrelated file. The hook fires, the reconciler is signalled, and
`reconciles` does **not** go up — the spec fingerprint is unchanged. Without that
check, every commit in the repo would re-apply every namespace.

### 4. Now go behind the platform's back

Open the Temporal Cloud UI, find `ws-<slot>-<name>-staging`, and change its
retention by hand. Nobody committed anything. No signal will arrive.

```bash
watch -n 10 'nsctl status <name>'
```

`driftsDetected` goes up, `lastDrift` names what you did, and the loop corrects it.

**Signals carry intent; the timer catches reality.** A control plane with only
signals converges on what people said. A control plane with a timer converges on
what is true. You just wrote both, four lines apart.

### 5. Remove an environment

Delete `prod` from the spec's `environments`, commit, and watch it be destroyed.
Convergence means removing what is no longer desired, not only adding what is — the
half people forget.
