# Instruqt

Instruqt is the **sandbox only**. The lab prose, the personalised commands and the
live checkpoints live in the portal (`portal/src/course/labs/lab*.ts`); see
CLAUDE.md for why there is no second copy here.

That split decides which of the commands below you actually need, and most of the
time the answer is none of them:

| What you changed | What ships it |
|---|---|
| Lab text, a command, a checkpoint | Deploy the portal. Nothing here. |
| A grader in `checks/` | Merge to the branch `LAB_REPO_REF` names. Nothing here. |
| Anything in the repo a student types against | Same — the sandbox clones the repo at boot. |
| `sandbox/config.yml` or the prebuild script | `instruqt sandbox push` **and** `publish` |
| `track/track.yml` or the one assignment | `instruqt track push` |

The middle rows are the important ones. The sandbox does not contain this repo —
`scripts/setup-platform-workshop` fetches it from `LAB_REPO_URL` at
`LAB_REPO_REF`, so a fix to a check script, a lab stub or `scripts/workshop`
reaches the next student the moment it is on that branch, with nothing pushed to
Instruqt at all.

### What the sandbox actually contains

Not the repo — an **allow-list** out of it, the `KEEP` array in the setup script:

```
Makefile go.mod go.sum .dockerignore .gitignore
cmd internal terraform worker schema specs deploy hooks
scripts/workshop scripts/workshop-check
instruqt/checks instruqt/sandbox/config.yml
```

`portal/` is the reason. It is half the repo by file count and it holds
`src/course/snippets/` — which *is* the answer key, there is no `solutions/` — plus
`grading.ts`, every checkpoint's pass condition. The repo is public, so leaving it
out is friction rather than a control; but a folder people already sit in gets
grepped, and one they would have to go and find does not. Also out: `_stubs/`
(feeds `make unsolve`, instructor-only), `services/` and the teardown scripts, and
the prose *about* the workshop — `DESIGN.md`, `CLAUDE.md`, `README.md` — since the
instructions a student needs are in the portal by design.

An allow-list, not a clone-then-delete, because a deny-list silently leaks
whatever lands in the repo next. **Adding a top-level directory a lab needs means
adding it to `KEEP`**, and the build asserts both directions — nothing excluded
arrived, and nothing named went missing — so a stale list fails the run instead of
surfacing three challenges in.

Two consequences worth knowing. `make verify`, `make solve` and `make unsolve` do
not work in a sandbox, by construction. And the checkout is a **fresh `git init`**
with one commit, not the clone's history: challenge 3 has a student commit a spec
and the post-commit hook signal the reconciler, so git has to work — but a fresh
repo gives that without carrying `git show HEAD:portal/...` along with it. It also
sets `user.email` and `user.name`, because there is nobody to ask, and without
them that commit stops on "Please tell me who you are".

## Layout, and where each command runs

Both CLI verbs are directory-sensitive: they read the config out of `$PWD`, and
run from `instruqt/` itself they fail on the missing config rather than telling
you to go one level down.

```
instruqt/
  track/       track.yml + 01-workshop/     -> run `instruqt track *` from here
  sandbox/     config.yml + scripts/        -> run `instruqt sandbox *` from here
  checks/      graders. Not pushed anywhere -- they run inside the sandbox, out of
               the student's own checkout at $WORKSHOP_DIR/instruqt/checks/
```

`sandbox/scripts/setup-<name>` is a convention, not a path in the config: the
suffix is the machine's `name` in `sandbox/config.yml`, which is why the file is
`setup-platform-workshop` and why the assignment's tabs say
`hostname: platform-workshop`. Rename the machine and all three have to move
together.

## First time on a machine

```bash
brew install instruqt/tap/instruqt
instruqt auth login
instruqt config list          # team = temporal
instruqt update               # the CLI self-updates, so `instruqt version` is
                              # worth recording when a push behaves differently
```

`instruqt config set team <slug>` if the team is wrong: every short slug below
resolves through it, so the full form is `temporal/temporal-platform-workshop`.

## Updating the sandbox

```bash
cd instruqt/sandbox
instruqt sandbox diff                       # local vs the remote draft
instruqt sandbox push                       # writes a DRAFT. Nothing is live yet
instruqt sandbox publish --message "why"    # builds the image, makes it live
```

Push and publish are separate on purpose: `push` uploads to a draft, `publish`
makes that draft the version runs will use. **Neither of them builds anything** —
both return in about a second.

That is the thing to get straight, because it decides where the setup script's
output goes. `scripts/setup-platform-workshop` runs when a **sandbox starts**, once
per run, on the machine itself — not at publish time. So its log lines carry a run
id and arrive through `instruqt track logs` or a `track test`, and its whole
runtime is time a student spends watching `loadingMessages`. A `FAIL` from the
egress probes or the image assertions aborts that run's setup, which is why they
are worth having: the run stops with a named cause instead of handing someone a
half-built box.

`push` refuses when there is nothing to send; `--force` overrides that.

### What the setup script can and cannot see

Two things about `scripts/setup-platform-workshop` that are not obvious and cost a
failed publish each:

**The `environment:` block in `config.yml` is not in scope for it.** That block is
what a *student's shell* gets. The setup script runs earlier and elsewhere — at
image build time — and sees none of it, which showed up as:

```
=== clone the platform
/tmp/setup: line 181: LAB_REPO_URL: unbound variable
```

So the script defaults `LAB_REPO_URL`, `LAB_REPO_REF` and `WORKSHOP_DIR` itself,
because it needs them before there is a checkout, and reads everything else
(`VAULT_ADDR`, the Vault root token, `PORTAL_URL`) out of `config.yml` once the
clone has made it readable. Those three defaults are the only values written twice
in this directory, and the script asserts they still match `config.yml` rather
than trusting it — **so changing `LAB_REPO_REF` in `config.yml` alone will fail the
build on purpose.** Change both.

**Anything it prints goes to a log, not to a student.** It runs before anybody has
a shell, so it is the wrong place for per-student output. The join link is
therefore built at shell start by `/etc/profile.d/workshop.sh`, out of
`$PORTAL_URL` and `$PORTAL_LINK_CODE` — both of which the setup script reads from
`config.yml` after the clone and writes into `/etc/workshop/env`, since the
`environment:` block reaches neither it nor, as far as anything here has proved, a
login shell. If students see "No portal link", the `PORTAL_LINK_CODE` line in
`config.yml` is empty.

## Updating the track

```bash
cd instruqt/track
instruqt track validate      # local files, plus the preset they reference
instruqt track push          # --force to overwrite remote changes
instruqt track open          # the URL, in a browser
```

**The sandbox comes first, and it is not a soft dependency.** `track.yml` names
`sandbox_preset: temporal-platform-workshop`, and both `push` and `validate`
resolve that preset against the platform before they will look at anything else:

```
==> Reading track definition
    [ERROR] failed to remote config (temporal-platform-workshop): Entity not found
```

That is the **preset** it cannot find, not the track — and because this workshop
gives the two the same slug, the message reads exactly like a missing track and
sends you off to create one. Confirmed by isolating it: adding that one
`sandbox_preset` line to a freshly scaffolded track that validates cleanly
reproduces the error, and removing it clears it. So if you see this, push and
publish the sandbox and come back.

### Two things `track push` does to your files

**It rewrites them, and it deletes every comment.** A push pulls the canonical
form back over your local copy: it adds `id:` to the track and to each tab, adds
`checksum`, `enhanced_loading` and any `lab_config` default it wants, reflows
folded strings, reorders `tags` — and strips all YAML comments and blank lines.
Comments written in `track.yml` or an `assignment.md` frontmatter survive exactly
until the next push, so **rationale for anything in those two files belongs in
this README instead.** (`sandbox push` does not do this: `config.yml` keeps its
comments, which is why that file is commented and these are not.)

It also **re-adds keys you delete.** `default_layout` and
`default_layout_sidebar_size` come back on the next push with the platform's own
values, so removing a key is not a way to turn something off — find the key that
turns it off instead.

The practical trap: an edit written against your pre-push copy will fail to match,
because the file on disk is no longer the file you wrote. Re-read before editing.

**Tab ids are the platform's, not yours.** They appear only after a push, which is
what makes the layout below possible — and what makes `track pull` into a scratch
directory the way to read them:

```bash
mkdir /tmp/pull && cd /tmp/pull && instruqt track pull temporal-platform-workshop
grep -A1 "^- id:" temporal-platform-workshop/01-workshop/assignment.md
```

### Removing the assignment panel

There is no "hide the assignment" flag. `default_layout` only chooses where to put
it — `AssignmentLeft`, `AssignmentRight`, `AssignmentBottom` — so the only way to
have no assignment pane is a `custom_layout` on the challenge that never mentions
one. It is a serialised JSON tree of leaves, each naming the tabs it holds:

```yaml
lab_config:
  custom_layout: '{"root":{"children":[{"leaf":{"tabs":["<terminal-id>","<editor-id>"],"activeTabId":"<terminal-id>","size":100}}],"orientation":"Horizontal"}}'
```

One leaf, `size: 100`, no `"assignment"` leaf: the terminal and editor get the
whole screen. `"assignment"` and `"feedback"` are the only literal tab names; every
other tab is referenced by the id above, and a layout naming an id that does not
exist renders nothing rather than erroring — so re-read the ids after any change
that deletes and recreates a tab.

`override_challenge_layout: true` in `track.yml` makes the track's own layout beat
this, which is why it is set to `false` there. `default_layout: AssignmentLeft`
sitting next to it is the platform's default, re-added on every push and inert
while `override_challenge_layout` is false — not a contradiction, and not worth
trying to delete.

### Removing the Instructions sidebar

A different panel with a different switch, and the two are easy to confuse. The
sidebar is the challenge navigation down the left; the assignment panel is the
prose beside it. One key, at track level:

```yaml
lab_config:
  sidebar_enabled: false
```

With a single challenge whose instructions live in the portal, it navigates
between one thing and is worth the screen space. (Borrowed from
`temporal-cloud-training-portal`, which is this track's ancestor and does the
same.)

**What this cost, and what covers it.** The assignment panel is also where a
challenge's `notes` are read, so removing it removes the sandbox's only in-lab
orientation text. Two things stand in for it and both are deliberate: the terminal
prints the portal join link at every shell start, and `code` explains the Editor
tab itself when no editor window is open yet.

## Testing and debugging a run

```bash
instruqt track test temporal-platform-workshop --keep-running
instruqt track logs temporal-platform-workshop --since 30m --severity ERROR
instruqt track checksum      # has the remote drifted from this checkout?
```

`track test` runs the lifecycle scripts (setup / check / solve / cleanup).
`--keep-running` leaves the environment up when it finishes or fails, which is the
only way to get inside a sandbox whose prebuild half-worked.

Two things about reading its output, both learned from green and red runs of it:

**It exits 0 even when it prints `FAIL`.** The `==> Track test succeeded` line is
the only reliable signal, so anything automated has to grep for it:

```bash
instruqt track test temporal-platform-workshop | tee /tmp/t.log
grep -q "Track test succeeded" /tmp/t.log || exit 1
```

**Log delivery drops lines.** Across two passing runs, one `ok` line from the
image checks and one from the egress probes never arrived, on runs that were
otherwise identical and green. A missing line is therefore not evidence of a
skipped step: the setup script is `set -euo pipefail` throughout, so anything that
failed would have exited non-zero and stopped the run. **Reaching `=== ready` is
the proof; individual lines are only a convenience.** That is also why the image
check prints the whole `k3s ctr images` listing at the end rather than trusting
three separate echoes.

This track has no per-challenge check scripts wired into Instruqt — the
checkpoints are graded by the portal against the Cloud account, or self-attested
and graded by hand with `checks/check-*` from inside the sandbox. So `track test`
proves the sandbox comes up; it does not prove a challenge is passable.

## Secrets

**This track uses none.** `PORTAL_LINK_CODE`, which opens the portal, is a plain
variable in `sandbox/config.yml` — so it is published with this repo, and rotating
it between cohorts is the whole control. Two places, both or neither, or the code
in the sandbox no longer opens the portal:

```bash
fly secrets set PORTAL_LINK_CODE=<new>       # the portal, in portal/
#   ... and the PORTAL_LINK_CODE line in sandbox/config.yml, then:
cd instruqt/sandbox && instruqt sandbox push --force && instruqt sandbox publish --message "rotate"
```

The setup script reads it out of `config.yml` after the clone and writes it into
`/etc/workshop/env`, because Instruqt's `environment:` block does not reach the
setup script and nothing has proved it reaches a login shell either.

The CLI does still have secret commands, if a future change needs one:

```bash
instruqt secrets list
instruqt secrets create NAME --data-file /path/to/value   # keeps it out of your history
instruqt secrets update NAME --data-file /path/to/value
```

There is deliberately **no** Cloud API key here. Each student creates their own
service account in challenge 1 and seeds its key into Vault with
`workshop init --api-key`, so nothing in this directory ever holds a live Temporal
Cloud credential. If you find yourself adding a secret to make a command work,
read the last section of CLAUDE.md first.

## The first push, in this order

Neither the track nor the preset exists on the platform yet, so the first time is
not the loop above — it is this, and the order is forced by the preset lookup:

```bash
cd instruqt/sandbox
instruqt sandbox push
instruqt sandbox publish --message "initial"

cd ../track
instruqt track validate     # only passes once the preset above resolves
instruqt track push
```

Two things worth knowing before you start, both learned the hard way:

**Neither `create` verb touches the platform.** `instruqt sandbox create` and
`instruqt track create` print `==> Creating temporal/<slug>` and then only scaffold
a local directory — a `sandbox diff` and a `track pull` for what they "created"
both come back `Entity not found`. They are for starting a new track from nothing,
not for registering this one, and running either in here would only lay a second
skeleton on top of the real files.

**So `sandbox push` is what has to create the preset,** by elimination: of the
five sandbox verbs it is the only one that writes. That is the single step in this
file nobody has run yet, and if it turns out to need the preset to already exist,
the platform's web UI is the way to make an empty one — everything else here has
been checked against the CLI.
