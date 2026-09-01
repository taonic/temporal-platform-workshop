# Working in this repo

A workshop, not a product. The code exists to be read and typed by students, so
"it compiles" is not the bar — the instructions have to match what the code
actually does, on the day, in front of a room.

## The rule that matters most

**A change to a script, command, flag, or flow is not finished until the lab
instructions say the new thing.** This repo is one where the docs *are* the
product: a student does what the lab tells them, and if the lab is stale they get
an error with no way to know the instruction was wrong rather than their typing.

This applies during development, not just before a cohort. There is no "I'll fix
the labs later" state that is safe to leave the repo in, because the labs are how
anyone — including you, next week — finds out what the workflow is supposed to be.

**Lab instructions live in exactly one place:** `portal/src/course/labs/lab*.ts` —
`steps[].lead`, `steps[].command`, `steps[].expect`, and the checkpoint text.

Instruqt is the **sandbox only**. It used to carry a second prose copy of every
challenge; that is gone, and `instruqt/track/01-workshop/assignment.md` is one thin
challenge holding the tab config and a pointer to the portal. Do not reintroduce
per-challenge assignment files — the portal personalises every command with the
student's username, cohort and region, which an assignment file cannot do, so the
second copy was always the one that went stale.

The graders survived the move: `instruqt/checks/check-*` still run inside a sandbox
and are what the self-attested checkpoints name.

Also check, in roughly this order of how often they go stale:

- `portal/src/course/snippets/*.ts` — **the answer key**. `pnpm snippets:emit`
  writes these into the working tree, so a snippet is real code that must compile.
  There is no `solutions/` directory; these are it.
- `_stubs/` — what a student starts from. If you change a comment in
  `internal/platform/environment.go`, the stub and the snippet both need it too,
  or `make unsolve` silently reverts your change.
- `README.md`, `DESIGN.md`, `deploy/platform/README.md`, `portal/README.md`,
  `instruqt/README.md` — the last one is how the sandbox gets updated, and it is
  the only place that says which changes need an `instruqt` push and which reach a
  student through the repo clone alone
- `scripts/workshop` usage text, and `portal/.env.example`

## Verify before saying it works

```bash
./scripts/workshop verify      # emit answers, build, test, validate, restore stubs
cd portal && pnpm check        # typecheck + every snippet claim resolves
```

`pnpm check` is cheap and catches a lab claiming a snippet that no longer exists.
`verify` is the one that proves the answer key still compiles.

Two known traps:

- **`verify` currently fails** at `go test ./internal/platform/...` with
  `unable to find activityType=CheckQuota` — the test harness does not mock
  `CheckQuota`. Pre-existing, not something you broke.
- **A failed `verify` leaves the repo solved, and this has already been
  committed once.** `verify` runs `unsolve` as its last step, so an earlier
  failure skips it — and the `CheckQuota` failure above is exactly such a
  failure. `2929796` shipped `main` with all four answers in it: the solved
  `main.tf`, a tracked `outputs.tf`, `register.go` and `greeting.py`. Every
  sandbox built from that branch handed students a completed workshop, and
  nothing complained, because a solved repo builds and its tests pass.

  So: **after any `verify`, run `git status` before you commit.** The tell is
  those four paths appearing as modified. `make unsolve` puts them back.
  `outputs.tf` is no longer tracked, which is what a student's clone should look
  like — lab 1 has them create it — so `unsolve` deleting it is now a no-op
  rather than a tracked deletion you have to notice.

## Things that will bite you

**Do not run `next build` while a dev server is up.** They share `portal/.next`,
and the build leaves a truncated `server-reference-manifest.json` behind — the dev
server then 500s with `__webpack_modules__[moduleId] is not a function`, and the
next build dies on `Unexpected end of JSON input`. `pnpm check` (typecheck plus
`snippets:check`) proves the same things and touches nothing. If it has already
happened: `rm -rf portal/.next` and restart the dev server.

**Never run a mutating command to "test" against the live environment.** Vault at
`127.0.0.1:30820` and the k3s cluster are real. `workshop base-up` writes to
`secret/platform/cloud-api-key`; `make base-up` deploys to the cluster. Check
`vault status` and `kubectl get ns` before assuming a command is inert, and use a
throwaway `VAULT_ADDR` when probing behaviour.

**The workshop has one front door.** `./scripts/workshop <verb>` — including every
Make target, which it forwards. `make help` prints the script's list rather than
keeping a second one, so add new verbs to `usage()` in `scripts/workshop`.

**Two identifiers per student, and they are not interchangeable.** The *handle*
(`tao`) names namespaces, Vault paths, tags and state files. The *address*
(`tao@temporal.workshop`) is the Authentik username and the Cloud identity,
because the SAML assertion carries it. `workshopEmail()` in `portal/src/config.ts`
is the only place that string is built.

**The API key is never an input.** It is pasted once, at the prompt `workshop init`
raises, lands in Vault, and every later command reads it from there. Two readers,
both at point of use and neither writing it to disk:

- `tpctl` reads it itself, in `dial()`, when the target is a Cloud address and
  `TEMPORAL_API_KEY` is unset. This is why `tpctl apply` and the post-commit
  hook's `tpctl sync` just work after `source "$(workshop env-file)"`.
- `workshop exec -- <cmd>` puts it in one command's environment for the life of
  that command, for the tools that cannot read Vault themselves — `terraform` and
  `temporal`.

It is deliberately **not** in the env file. Writing it there would put a live
credential in plaintext on disk and into every shell that sources it, which is the
thing this arrangement exists to prevent. If you find yourself adding a step that
takes a key, or exporting one to make a command work, that is a bug in the design,
not a step.

## Style

Match the surrounding prose. Comments here explain *why*, often at length, and
frequently record what was tried and rejected — that is deliberate and worth
continuing. Lab text is written to be read once, under time pressure, by someone
who is stuck: put the action first, the reasoning second, and the caveat where it
is needed rather than at the end.
