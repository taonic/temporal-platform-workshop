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

Your control plane is running. It knows how to run Terraform, stream the output as
heartbeats, and adopt resources a previous attempt orphaned.

It has no module to apply. That is your job.

### 1. Write the module

Open `terraform/namespace/main.tf`. It is a comment block: read it, then write the
three resources it describes, plus the two outputs in a new `outputs.tf`.

```bash
cd terraform/namespace && terraform validate
```

The one instruction worth re-reading is the one telling you what **not** to write.
`temporalcloud_apikey` exposes `.token` as a readable attribute, and
`sensitive = true` masks CLI output without encrypting anything — so minting a key
here would put a live credential in plaintext into remote state. The platform mints
keys through the Cloud Ops API instead, in an activity that writes straight to
Vault and returns a path.

### 2. Ask the four questions

```bash
nsctl new
```

Look at what it wrote in `specs/`. Two things are **not** in that file: your
participant id and your slot number. A team asks for a namespace; it does not get
to choose which slot it lands in. That boundary — what you asked for versus what
the platform decided — is what this whole workshop is about.

### 3. Provision it

```bash
nsctl apply -f specs/<name>.yaml
```

Open the **Temporal UI** tab while it runs. Find the workflow, expand the
`TerraformApply` activity, and watch the heartbeat details: that is your module's
own stdout, streamed line by line. Six lines of platform code, and the difference
between "it is working" and "I hope it is working".

### 4. Check the rule held

```bash
vault kv get secret/namespaces/$WORKSHOP_PARTICIPANT/<name>/staging
temporal workflow show -w provision-<name> | grep -c "tmprl_" || echo "no credential in the history"
```

The credential column in the output was a **Vault path**, not a key.

### Why imperative?

Because your first twenty minutes need a visible win. A declarative loop that
silently does nothing has four candidate failure points — the CLI, the hook, the
workflow, or your Terraform — with no way to tell them apart. You will invert this
into a control loop in challenge 3, using the same activities and the same child
workflows. Only the driver changes.
