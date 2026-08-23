# Terraform state service

Three verbs, one volume, and no locking. The reconciler's child workflow id is the
resource identity, so Temporal's uniqueness constraint already guarantees a single
writer per state file — `LOCK` and `UNLOCK` refuse, and say why.

## Run it locally

```bash
make build

export STATE_SHARED_SECRET=$(openssl rand -hex 32)
STATE_DIR=./.tfstate PORT=8080 ./bin/tfstate
```

Per-participant tokens are derived from the secret, so there is no database and no
token list to keep in sync:

```bash
export STATE_TOKEN=$(printf '%s' "$WORKSHOP_PARTICIPANT" \
  | openssl dgst -sha256 -hmac "$STATE_SHARED_SECRET" -hex | awk '{print $2}' | cut -c1-40)
export STATE_SERVICE_URL=http://127.0.0.1:8080
```

The platform picks both up from the environment. `STATE_TOKENS="p-1:abc,p-2:def"`
overrides derivation with a static list if you would rather hand tokens out.

Check it:

```bash
curl -s localhost:8080/healthz
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/state/p-1/orders/staging          # 401
curl -s -X LOCK -u "p-1:$STATE_TOKEN" localhost:8080/state/p-1/orders/staging             # 405, with the reason
```

Not running it at all is also fine: set `stateBackend: local` in a spec and the
platform writes to `$STATE_DIR` instead. That fallback exists because egress
failure is the most common sandbox complaint, and a student who cannot reach this
service should still be able to finish the lab.

## Deploy to Fly

**From the repo root**, not from this directory — the Dockerfile needs `go.mod`, so
the build context has to be the root:

```bash
fly launch --no-deploy -c services/state/fly.toml --name temporal-workshop-tfstate
fly volumes create tfstate --size 1 --region syd -a temporal-workshop-tfstate
fly secrets set STATE_SHARED_SECRET=$(openssl rand -hex 32) -a temporal-workshop-tfstate
fly deploy -c services/state/fly.toml

curl -s https://temporal-workshop-tfstate.fly.dev/healthz
```

Then set the same secret as an Instruqt sandbox secret, so the setup script derives
the same tokens.

## One machine, on purpose

`auto_stop_machines = false`, `min_machines_running = 1`, and never scale past one.
Two machines means two volumes means two different answers to "what is the current
state".

The cost is real: a deploy mid-workshop will fail somebody's state write. That is
survivable only because the reconciler imports before it applies — see
`tfworkspace.ApplyInput.AttemptImport` — which re-adopts resources whose state
never landed. Deploy between cohorts, not during one.
