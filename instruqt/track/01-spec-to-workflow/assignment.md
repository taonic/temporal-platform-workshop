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
  # No local dev server on this branch, so nothing is listening on 8233. The UI
  # is the real Cloud one, which is also what a platform engineer would actually
  # be looking at.
  - id: temporal
    title: Temporal UI
    type: external
    url: https://cloud.temporal.io
difficulty: basic
timelimit: 2700
---

Your control plane is built and has nowhere to run. It knows how to run Terraform,
stream the output as heartbeats, and adopt resources a previous attempt orphaned —
but it needs a namespace of its own, and it has no module to apply.

Both of those are your job. Only one of them is a job you will ever do by hand
again.

One housekeeping note, because the commands below lean on it. Every shell in this
sandbox sources `/etc/workshop/env`, which is where `$WORKSHOP_USERNAME`,
`$WORKSHOP_COHORT`, `$VAULT_ADDR`, `$STATE_SERVICE_URL` and `$STATE_TOKEN` come from — the sandbox sets
them once at provision time so nothing in this track asks you to paste an id or a
token. `cat /etc/workshop/env` to see yours. The one thing deliberately *not* in
there is the Cloud API key: it lives in Vault and nowhere else, so a student running
`history` cannot find it. Step 2 borrows it from there, deliberately and briefly.

### 1. Point this machine at the identity you chose

You picked a username at the join screen, and everything from here is named after
it — your namespaces, your Vault paths, your state files. That is why you chose it
rather than being handed a number.

The join screen printed this line with both values already filled in. Paste it
rather than retyping:

```bash
./scripts/workshop-creds init --username <yours> --state-token <from the portal>
source "$(./scripts/workshop-creds env-file)"
```

It writes the `TF_VAR_*` variables Terraform reads, your Vault and state-service
addresses, and the token the state backend authenticates with. Note what is **not**
in it: the Cloud API key. That lives in Vault, and nothing after this takes a key
as input.

Lost the line? Go back to the join link and type the same username. That returns
your account rather than refusing it — which is also how you recover a password
you did not save.

### 2. Give the platform its own identity

Yours is not the platform's. **You** hold Global Admin, because a student has to
see everything; your platform gets something much narrower, and challenge 5 is
where you notice it was enough.

In the **Cloud UI → Settings → Service Accounts**, create one:

| | |
|---|---|
| Name | `platform-$WORKSHOP_USERNAME` |
| Account role | **Developer** |

Then generate an API key for it and **copy it now** — Temporal shows it once and
there is no way to read it back. The only recovery is creating another.

**Developer, not Admin.** The platform creates namespaces, service accounts, API
keys and tags. It never administers a user, and granting a user access to a
namespace is the one thing it genuinely cannot do. Challenge 5 is where that stops
being a claim: you will run the whole paved road on this identity and notice
nothing was missing.

The key list is account-wide. Name yours so you can find it among two dozen, and
**do not delete a key that is not yours** — one of them belongs to the identity
that grades this workshop.

> In this sandbox the service account and its key already exist, and the key is
> already in Vault. Read the above, then run step 3 and move on.

### 3. Put the key where the platform reads it

```bash
make check
```

Tools, cluster, Vault, egress, control plane — every probe runs, so you see
everything wrong at once rather than one thing at a time.

Read `warn` and `FAIL` differently. **`warn` means not built yet**: no
`platform-worker` deployment and no control namespace is exactly right before you
start, and both turn green as you work through this challenge. **`FAIL` means
broken**, and the line tells you the fix.

The line that matters right now is `platform cloud api key present`. If it is
missing — which it will be on your own machine, the first time — seed it once:

```bash
TEMPORAL_CLOUD_API_KEY=<the key you just created> make base-up
unset TEMPORAL_CLOUD_API_KEY
make check
```

That is the **only** moment in this workshop when the key is an environment
variable. It goes into Vault, the variable is unset, and `history` does not have
it. Nothing after this takes a key as input: `./scripts/workshop-creds exec` reads
it from Vault, hands it to one process, and lets it die there.

Which makes this the useful thing to remember: **if anything later asks you to
paste a key, that is a fault, not a step.** It means Vault is empty. Come back
here.

### 4. Write the module

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

### 5. Run your own module by hand, once

Something has to create the namespace the namespace-creator runs in. This is the
only time you do it, and you do it with the module you just wrote:

```bash
terraform -chdir=terraform/namespace init
./scripts/workshop-creds exec -- terraform -chdir=terraform/namespace apply
```

**No flags.** Step 1 already wrote `TF_VAR_namespace_name`, `TF_VAR_region`,
`TF_VAR_retention_days` and `TF_VAR_tags` into your environment, and `TF_VAR_<name>`
is how Terraform reads a variable from there — so there is nothing here to mistype.

`workshop-creds` is the same helper the Cloud training portal uses, with one
difference worth knowing: it does **not** write the API key anywhere.
`./scripts/workshop-creds exec` fetches it from Vault, puts it in the environment of
one command, and lets it die with that process. If it prompts you for a key
instead, Vault is empty — go back to step 3.

Everything you type in this workshop is `make <verb>` — run `make` on its own for
the list — with one exception: `./scripts/workshop-creds`, which hands a credential
to an arbitrary command and sometimes prompts, neither of which Make can express.
Run it by path from the repo root; that works in this sandbox and on a laptop
alike, with nothing to install and nothing on `PATH`. Every command in this
challenge stays at the repo root; `terraform -chdir=` is what keeps it there.

`./scripts/workshop-creds env-file` prints where it wrote: `/etc/workshop/env` here,
`~/.workshop-env` on a laptop. The lab asks for it by command rather than by path
because those differ and the instruction must not.

`./scripts/workshop-creds show` prints exactly what it set. Everything in there is
safe to print, which is the point.

Three things to notice, and they are the argument of the whole challenge.

**The tag.** You set `provisioner=human-bootstrap`. Every namespace after this one
will say `platform-reconciler`, written by the reconciler itself rather than typed
by a person — which is why the grader treats it as evidence rather than as a label.
This one namespace is the exception that makes the rule visible.

**The credential's lifetime.** `./scripts/workshop-creds exec` read the key from Vault, put it
in the environment of one process, and let it die there. That is exactly what the
Terraform activity does — reads from Vault, exports for the lifetime of one
activity attempt, never writes to disk. The helper is not a convenience wrapper
hiding the rule; it is the rule, performed by hand.

**What it cost.** Even with a helper filling in the variables, you needed a region
id, a retention nobody asked you for, an `init`, and a state file you now own — and
you had to know that the tag set is written by *this* resource and no other. In
steps 7 and 8 the same module runs from four answers typed into a wizard, with none
of that. Multiply the difference by every team at your company and you have the
problem this workshop exists to solve.

### 6. Point the control plane at it, and start it

```bash
./scripts/workshop-creds control              # reads namespace_id out of the state
source "$(./scripts/workshop-creds env-file)"

make platform-up
```

A Cloud namespace id is `<name>.<account>`, never quite the name you typed, so
`workshop-creds control` reads it out of the Terraform state and records it as
`CONTROL_NAMESPACE` rather than making you copy it from a table.

`make platform-up` builds the worker image, hands it to the kubelet, and rolls the
Deployment. That build is what carries your module into the pod:
`terraform/embed.go` compiles `terraform/namespace/*.tf` **into the worker binary**,
so the control plane needs no checkout, no mounted volume and no git — one
self-contained image.

The consequence is worth holding onto. **The control plane never reads the file you
edited**, only the copy inside its own binary. Editing the module later and
restarting the pod would change nothing; you need `make reload`, which rebuilds the
image, reimports it and rolls the Deployment. You will use it in challenges 2 and 3,
where the Go you write is compiled into this same binary.

`make logs` follows the worker. It should say it is listening on the platform task
queue — if it does not, it could not read its own Cloud key from Vault, which is
where that key lives and the only place it lives. There is no credential in the
Deployment manifest: the pod authenticates to Vault as its own ServiceAccount, the
same mechanism the managed worker switches to in challenge 4.

### 7. Ask the four questions

```bash
nsctl new
```

Look at what it wrote in `specs/`. One thing is **not** in that file: your
username. A team asks for a namespace; it does not get to decide what the
platform calls it or where it puts it. That boundary — what you asked for versus what
the platform decided — is what this whole workshop is about.

### 8. Provision it

```bash
nsctl apply -f specs/<name>.yaml
```

Open the **Temporal UI** tab while it runs — it points at cloud.temporal.io, at the
namespace your control plane itself runs on. Find the workflow, expand the
`TerraformApply` activity, and watch the heartbeat details: that is your module's
own stdout, streamed line by line. Six lines of platform code, and the difference
between "it is working" and "I hope it is working".

### 9. Check the rule held

```bash
vault kv get secret/namespaces/$WORKSHOP_USERNAME/<name>/staging
./scripts/workshop-creds exec -- temporal workflow show -w provision-<name> \\
  | grep -c "tmprl_" || echo "no credential in the history"
```

The credential column in the output was a **Vault path**, not a key.

### Why imperative?

Because your first twenty minutes need a visible win. A declarative loop that
silently does nothing has four candidate failure points — the CLI, the hook, the
workflow, or your Terraform — with no way to tell them apart. You will invert this
into a control loop in challenge 3, using the same activities and the same child
workflows. Only the driver changes.
