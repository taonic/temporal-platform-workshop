---
slug: spec-to-workflow
id: 01
type: challenge
title: Spec to workflow
teaser: Turn four answers into one real namespace, with Terraform inside an Activity.
notes:
  - type: text
    contents: |-
      A platform starts with a question: what does a team actually ask for?

      OpenAI's answer, from their Replay talk, was four things — **name, owner,
      tier, retention**. Not a Terraform module, not a ticket. Four answers, and
      the platform does the rest.

      You are going to build that, imperatively first: a CLI that writes a spec,
      and a Workflow that reads it and runs Terraform in an Activity.
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
difficulty: basic
timelimit: 2700
---

Your control plane is already running. It has no idea what you want yet.

### 1. Ask the four questions

```bash
nsctl new
```

Look at what it wrote in `specs/`. Two things are *not* in that file: your
participant id and your slot number. That is deliberate — a team asks for a
namespace, it does not get to choose which slot it lands in. The boundary between
"what you asked for" and "what the platform decided" is the boundary this whole
workshop is about.

### 2. Provision it

```bash
nsctl apply -f specs/<name>.yaml
```

Open the **Temporal UI** tab while that runs and find the workflow. Expand the
`TerraformApply` activity and watch the heartbeat details: that is terraform's own
stdout, streamed line by line. Six lines of code, and the difference between "it is
working" and "I hope it is working".

### 3. Read what came back

The credential column is a **Vault path**, not a key.

That is not tidiness. `temporalcloud_apikey` exposes `.token` as a readable
attribute, and `sensitive = true` masks CLI output without encrypting anything — so
minting keys in Terraform would write live credentials in plaintext into remote
state. Instead a separate Activity calls the Cloud Ops API and writes straight to
Vault, returning a path. Nothing sensitive in state, nothing sensitive in event
history, and rotation stops being state surgery.

Prove it to yourself:

```bash
vault kv get secret/namespaces/$WORKSHOP_PARTICIPANT/<name>/staging
temporal workflow show -w provision-<name> | grep -ci "api_key\|tmprl_" || echo "no credential in the history"
```

### Why imperative?

Because your first twenty minutes need a visible win. A declarative loop that
silently does nothing has four candidate failure points — the CLI, the hook, the
workflow, or terraform — and no way to tell them apart. You will invert this into a
control loop in challenge 3, using the same Activities and the same child
workflows. Only the driver changes.
