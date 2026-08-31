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
`scripts/setup-platform-workshop` clones it from `LAB_REPO_URL` at
`LAB_REPO_REF`, so a fix to a check script, a lab stub or `scripts/workshop`
reaches the next student the moment it is on that branch, with nothing pushed to
Instruqt at all.

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

Push and publish are separate on purpose, and only the second one costs real
time. `push` uploads; `publish` is what runs
`scripts/setup-platform-workshop` to build the image every student then boots
from. **A failed prebuild fails the publish**, and the build log is the only place
its output appears — so a `FAIL` line from the egress probes or the image
assertions surfaces here, once, rather than in front of a room.

`push` refuses when there is nothing to send; `--force` overrides that.

## Updating the track

```bash
cd instruqt/track
instruqt track validate      # local files, but it also reads the remote track
instruqt track push          # --force to overwrite remote changes
instruqt track open          # the URL, in a browser
```

`track.yml` names `sandbox_preset: temporal-platform-workshop`, so the preset has
to exist and be published before a pushed track can start. Push the sandbox
first.

Note what `validate` does: it loads the local files **and then looks the track up
remotely**, so on a track that has never been pushed it fails with
`failed to remote config (...): Entity not found`. That is the remote lookup, not
your YAML.

## Testing and debugging a run

```bash
instruqt track test temporal-platform-workshop --keep-running
instruqt track logs temporal-platform-workshop --since 30m --severity ERROR
instruqt track checksum      # has the remote drifted from this checkout?
```

`track test` runs the lifecycle scripts (setup / check / solve / cleanup).
`--keep-running` leaves the environment up when it finishes or fails, which is the
only way to get inside a sandbox whose prebuild half-worked.

This track has no per-challenge check scripts wired into Instruqt — the
checkpoints are graded by the portal against the Cloud account, or self-attested
and graded by hand with `checks/check-*` from inside the sandbox. So `track test`
proves the sandbox comes up; it does not prove a challenge is passable.

## Secrets

```bash
instruqt secrets list
instruqt secrets create PORTAL_LINK_CODE --data-file /path/to/code
instruqt secrets update PORTAL_LINK_CODE --data-file /path/to/new-code
```

One secret, `PORTAL_LINK_CODE`, which opens the portal — rotate it after a cohort
and every outstanding join link dies at once. `--data-file` rather than a value
argument keeps it out of your shell history.

There is deliberately **no** Cloud API key here. Each student creates their own
service account in challenge 1 and seeds its key into Vault with
`workshop init --api-key`, so nothing in this directory ever holds a live Temporal
Cloud credential. If you find yourself adding a secret to make a command work,
read the last section of CLAUDE.md first.

## Not yet pushed

Neither the track nor the preset exists on the platform yet — `sandbox diff` and
`track validate` both report no remote config as of this writing. The first
`sandbox push` and `track push` are what create them, and the first `publish` is
the first real test of the prebuild script. Everything above is the CLI's own
documented behaviour and its verified flags; the first-push path itself is the one
thing here nobody has run.
