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
cp .env.example .env.local     # then fill in TEMPORAL_CLOUD_API_KEY
pnpm dev
```

`pnpm dev` prints the links before Next starts, so there is no URL to assemble by
hand:

```
  Lab links - participant p-dev, slot 7

  overview    http://localhost:3000/?k=devcode&p=p-dev&t=6e6b4ba2…&slot=7
  lab 1       http://localhost:3000/lab/1?k=devcode&p=p-dev&t=6e6b4ba2…&slot=7
  ...
  instructor  http://localhost:3000/instructor?t=…
```

Override the identity with `DEV_PARTICIPANT` and `DEV_SLOT`, and the port with
`PORT`. `pnpm link:lab` prints them again without restarting anything.

The token is derived with the same HMAC the sandbox and the state service use, so a
link printed here is the same shape a student gets — including the four values the
pages actually require.

A `.env.local` with placeholders is already committed-adjacent (gitignored), so
`pnpm dev` works before you have a Cloud key: **lab material renders, and only the
checkpoints panel reports the missing credential.** That is deliberate — a single
config check that threw on any absent value turned a missing Cloud key into a 500
on every page, so the credential is required at the point of use rather than at
startup.

`.env.example` documents every value and why it exists. The short version:

| | |
|---|---|
| `PORTAL_LINK_CODE` | Opens the portal. Rotate to retire every link |
| `PORTAL_SHARED_SECRET` | Derives per-participant tokens. Same value as the state service's |
| `PORTAL_INSTRUCTOR_TOKEN` | Gates `/instructor`. Omit it and that page is unreachable |
| `TEMPORAL_CLOUD_API_KEY` | The portal's read credential. An instructor identity, Read-Only is enough |
| `PORTAL_ACCOUNT_ID` | For rendering fully qualified namespace ids |
| `PORTAL_COHORT_SIZE` | The denominator on `/instructor` |
| `PORTAL_SANDBOX_URL` | Shown to anyone arriving without a usable link |

Missing values are reported all at once, not one per restart:

```
portal configuration is invalid:
  PORTAL_ACCOUNT_ID: PORTAL_ACCOUNT_ID is required
  PORTAL_SHARED_SECRET: PORTAL_SHARED_SECRET must be at least 16 characters
```

## Two gates, two jobs

A student's link carries four values, and the sandbox prints it for them:

```bash
P=p-abc123
T=$(printf '%s' "$P" | openssl dgst -sha256 -hmac "$PORTAL_SHARED_SECRET" -hex \
     | awk '{print $2}' | cut -c1-40)
echo "http://localhost:3000/lab/1?k=$PORTAL_LINK_CODE&p=$P&t=$T&slot=7"
```

**`PORTAL_LINK_CODE` opens the portal.** It is a plain configured code, not a hash of
anything — the training portal tried an HMAC of a secret and found that hashing a
secret to produce one fixed string bought nothing over configuring that string. It
tried daily rotation too, and that locked students out halfway through their own
window. So expiry is an *action*, not a clock:

```bash
fly secrets set PORTAL_LINK_CODE=<new>    # every outstanding link dies at once
```

**`PORTAL_SHARED_SECRET` binds the identity.** Per-participant tokens are derived
from it with the same HMAC scheme the Terraform state service uses, so one secret
produces every token in the workshop and there is no second list to keep in sync.

The two are deliberately different values. That secret is shared with the state
service, so rotating it to retire a portal link would also break the state-backend
auth that fifteen sandboxes are mid-apply with. The code retires links; the secret
binds identity; neither rotation breaks the other.

Both are lab aids, not access controls. The code keeps strangers out of the portal
and the token stops one student reading another's progress by editing a URL. Okta and
the Cloud's own RBAC are what actually protect anything.

Deploy the code as a secret rather than plain config: six characters projected onto a
wall are not much of a secret, but they are the only thing between a stranger and the
portal, and a value in git is a value that outlives the workshop it was for.

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
