# Workshop portal

Lab material and live checkpoints for the platform workshop. No database.

## What it can see, and what it cannot

Each student's control plane runs on a Temporal dev server **inside their own
sandbox**, and nothing central has ingress to it. The one surface every student
shares is the Temporal Cloud account, so that is what the portal reads: namespaces,
their **tags**, and service accounts.

`Namespace.tags` is a field on the Namespace message in the Ops API, which is what
makes this work at all — and it is why the reconciler stamps `participant` and
`drift-corrected-at` into the tag set. Drift correction is otherwise invisible from
outside a sandbox, and it is the whole point of challenge 3.

Anything that exists only inside a sandbox — a pod on k3s, a secret in Vault, a
completed workflow in the student's own namespace — is marked **self-attested** and
graded by that challenge's Instruqt check instead. The portal says so on the page. A
grader that implied it had verified those would be worse than one that admits it did
not.

| Challenge | Graded here | Graded in the sandbox |
|---|---|---|
| 1 Spec to workflow | namespace exists, provisioner tag, api-key auth, retention | credential absent from event history |
| 2 Fan-out and identity | both environments, namespace-scoped worker identity, write not admin | Vault paths resolve |
| 3 Invert to declarative | `drift-corrected-at` tag, retention reconverged, tag set complete | reconciler Query state |
| 4 The paved road | the namespace is still healthy | pod ready, polling, Vault k8s auth |
| 5 Be the developer | a second spec exists in the slot | a workflow completed, and how long it took |

## Run it locally

```bash
pnpm install

export TEMPORAL_CLOUD_API_KEY=...        # the instructor's key, not a student's
export PORTAL_ACCOUNT_ID=acct1
export PORTAL_SHARED_SECRET=$STATE_SHARED_SECRET   # deliberately the same secret
export PORTAL_INSTRUCTOR_TOKEN=$(openssl rand -hex 24)

pnpm dev
```

A student's link carries three values. Derive the token the same way the state
service does:

```bash
P=p-abc123
T=$(printf '%s' "$P" | openssl dgst -sha256 -hmac "$PORTAL_SHARED_SECRET" -hex \
     | awk '{print $2}' | cut -c1-40)
echo "http://localhost:3000/lab/1?p=$P&t=$T&slot=7"
```

One secret, one HMAC scheme, two services — rather than a second token list to keep
in sync with the first. The token stops a student reading another student's progress
by editing a URL and nothing more; Okta and the Cloud's own RBAC are the real access
control.

Instructor view: `/instructor?t=$PORTAL_INSTRUCTOR_TOKEN`. It lists every
participant, which is why it has its own long-lived token — the student link gets
pasted into chat.

## Deploy

```bash
fly launch --no-deploy -c fly.toml
fly secrets set TEMPORAL_CLOUD_API_KEY=... PORTAL_ACCOUNT_ID=... \
  PORTAL_SHARED_SECRET=... PORTAL_INSTRUCTOR_TOKEN=... PORTAL_SANDBOX_URL=...
fly deploy
curl -s https://temporal-workshop-portal.fly.dev/healthz
```

Stateless, so unlike the state service this one can scale to zero and run more than
one machine.

## Adding a lab

`src/course/labs/labN.ts` — one `LabDef` with `steps()` for the material and
`grade()` for the checkpoints, then add it to `src/course/index.ts`. `grade()` gets a
memoised account inventory, so five checkpoints cost one pair of API calls rather
than ten; the training portal learned that against a 180-requests-per-hour budget.

A `grade()` that names a checkpoint id the lab does not declare throws at request
time rather than rendering a blank row.
