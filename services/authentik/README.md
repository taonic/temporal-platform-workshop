# Authentik — workshop SAML IdP

The workshop's identity provider, self-hosted on Fly. It replaced an Okta
developer tenant because Okta's user cap is lower than a cohort plus the cohorts
before it; Temporal Cloud's own limit is 300 users per account, so Temporal was
never the constraint. See DESIGN.md, *Identity via Authentik*.

**Read this first.** This is a total-outage dependency. If Authentik is down at
09:00, nobody logs into Temporal Cloud and the workshop does not start. It also
holds two things that cannot be regenerated — a signing keypair Temporal has
pinned, and a database of registrations nothing else can rebuild. The steps below
are ordered so that both survive a rebuild; the order is the point.

Budget **half a day**, most of it waiting on Temporal support.

---

## Before you start

| | |
|---|---|
| `flyctl` | `brew install flyctl && fly auth login` |
| A domain | Identifier namespace only. **No MX, no mailbox** — see below |
| Temporal Cloud | Account-owner access, to file the support ticket |
| `openssl`, `jq` | Both are used below |

---

## 1. Generate the SAML keypair — before anything else

This is step one for a reason. Authentik generates a self-signed certificate on
first boot, and if you let it, that certificate is the one Temporal pins in your
SSO configuration. Rebuild the app or lose the volume and you are filing another
support ticket with weeks of lead time.

Generate it yourself, keep it, inject it:

```bash
openssl req -x509 -newkey rsa:4096 -nodes -days 1825 \
  -keyout saml.key -out saml.crt -subj "/CN=temporal-platform-workshop"
```

Five years, deliberately: it must outlive every cohort you plan to run, because
its expiry is a support ticket rather than a renewal.

**Put `saml.key` and `saml.crt` somewhere that survives you losing a laptop** — a
password manager, not the repo. `saml.crt` goes in the support ticket. If you lose
`saml.key`, SAML breaks and only Temporal support can fix it.

---

## 2. Create the app and its data stores

```bash
fly apps create temporal-workshop-authentik

# Managed, because this database holds every student's registration and nothing
# can rebuild it -- identities are created at join time, not in Terraform.
fly mpg create --name temporal-workshop-authentik-db --region syd
```

**Every other `fly mpg` command takes the cluster ID, not the name.** Passing the
name fails with `managed postgres cluster "..." not found`, which reads like the
cluster does not exist. Capture the ID once:

```bash
fly mpg list --org <your-org-slug>          # fly orgs list, if you are unsure
CLUSTER=$(fly mpg list --org <your-org-slug> --json | jq -r \
  '.[] | select(.name == "temporal-workshop-authentik-db") | .id')
echo "$CLUSTER"                             # e.g. 1zvn90k11w4rkpew
```

Then attach, and create the Redis:

```bash
fly mpg attach "$CLUSTER" --app temporal-workshop-authentik

# Authentik's task queue. Small: the workload is a handful of logins.
fly redis create --name temporal-workshop-authentik-redis --region syd
```

### Getting the database password

Copy the connection string when `fly mpg attach` prints it. If you did not, there
are two ways back and one common misconception.

**The misconception:** `fly secrets list` shows digests rather than values, which
reads as "secrets are unrecoverable". They are not. A secret is an ordinary
environment variable inside the machine, so once anything is deployed:

```bash
fly ssh console -a temporal-workshop-authentik -C "printenv DATABASE_URL"
```

That works even when the app is unhealthy — the machine only has to be *started*,
not passing checks, which it will not be until the database is configured. So the
bootstrap order is: deploy with the secrets you have, read the DSN out, set the
`AUTHENTIK_POSTGRESQL__*` variables from it, redeploy.

**If nothing is deployed yet**, mint a fresh password instead — re-attaching
issues a new one and prints it:

```bash
fly mpg attach "$CLUSTER" --app temporal-workshop-authentik \
  --username authentik --variable-name AUTHENTIK_DSN
```

`--variable-name` keeps it clear of the `DATABASE_URL` a plain attach sets, so this
is safe to repeat — and repeating it is also how you rotate.

**Two dead ends, both of which look like the answer.** `fly mpg users create` makes
the role and returns no password — and never shows one afterwards, since
`users list --json` carries only name and role:

```console
$ fly mpg users create "$CLUSTER" --username authentik --role schema_admin
User created successfully!
  Name:
  Role: MANAGED_ROLE_SCHEMA_ADMIN
```

The role can log in, but nothing knows its password, including Fly. And you cannot
fix that over psql, because no role you can connect as has `CREATEROLE`:

```console
$ echo "ALTER USER authentik PASSWORD '...';" | fly mpg connect "$CLUSTER"
ERROR:  permission denied to alter role
DETAIL:  To change another role's password, the current user must have the
         CREATEROLE attribute and the ADMIN option on the role.
```

Only `postgres` is a superuser on a Managed Postgres cluster, and Fly does not hand
it out. **So a role created any way other than `attach --username` is permanently
unusable.**

Simplest of all: the `fly-user` from a plain `attach` is already `schema_admin`,
which is exactly what Authentik needs. Use that DSN and create nothing.

### Configuring Authentik

Fly gives you one `DATABASE_URL`; Authentik wants five separate variables and does
not read a DSN. But there is nothing to parse — **only the password is unknowable.**
Everything else is fixed or derivable from the cluster id:

| | |
|---|---|
| user | `fly-user` |
| database | `fly-db` |
| host | `pgbouncer.$CLUSTER.flympg.net` |
| port | `5432` (absent from Fly's DSN, which is why a naive parse yields `None`) |

So carry one secret, not a URL:

```bash
PGPASSWORD='<the password from fly mpg attach>'
PGHOST="pgbouncer.${CLUSTER}.flympg.net"

fly secrets set --app temporal-workshop-authentik \
  AUTHENTIK_POSTGRESQL__USER=fly-user \
  AUTHENTIK_POSTGRESQL__PASSWORD="$PGPASSWORD" \
  AUTHENTIK_POSTGRESQL__HOST="$PGHOST" \
  AUTHENTIK_POSTGRESQL__PORT=5432 \
  AUTHENTIK_POSTGRESQL__NAME=fly-db
```

### Redis — the same shape, and the same trap

Authentik reads discrete variables here too. **There is no `AUTHENTIK_REDIS__URL`**;
set one and Authentik ignores it silently, falls back to its default, and logs this
at `level: info`:

```json
{"event": "Redis Connection failed, retrying... (Error 111 connecting to
 localhost:6379. Connection refused.)", "level": "info"}
```

`localhost:6379` in that message is the tell: it is the default, which means nothing
you set was read.

Fly's Redis URL is `redis://default:<password>@fly-<name>.upstash.io:6379` — plain
`redis://`, so no TLS. Split it the same way:

```bash
REDIS_URL='<the redis:// url fly printed>'
RHOST=$(python3 -c 'import sys,urllib.parse as u; print(u.urlsplit(sys.argv[1]).hostname)' "$REDIS_URL")
RPASS=$(python3 -c 'import sys,urllib.parse as u; print(u.unquote(u.urlsplit(sys.argv[1]).password))' "$REDIS_URL")

fly secrets set --app temporal-workshop-authentik \
  AUTHENTIK_REDIS__HOST="$RHOST" \
  AUTHENTIK_REDIS__PORT=6379 \
  AUTHENTIK_REDIS__USERNAME=default \
  AUTHENTIK_REDIS__PASSWORD="$RPASS" \
  AUTHENTIK_REDIS__TLS=false
```

Lost the URL? Same recovery as the database — `fly ssh console -a <app> -C
"printenv AUTHENTIK_REDIS__URL"`, or `fly redis status <name>`.

The password goes in **literally** here. These are discrete variables, not URL
components, so percent-encoding it would set a wrong password — with a symptom
(authentication failure at boot) you would waste an hour blaming on the host.

### Rebuilding the DSN, when you need one

`psql`, `pg_dump` and anything else URL-shaped want it back as one string. Same
inputs, and this is the case where the password **must** be encoded:

```bash
DSN="postgresql://fly-user:$(python3 -c \
  'import sys,urllib.parse as u; print(u.quote(sys.argv[1], safe=""))' \
  "$PGPASSWORD")@${PGHOST}/fly-db"
```

That is the whole difference: `fly secrets set` takes the raw password, a URL takes
the encoded one. Getting it backwards fails in both directions and neither error
says so.

---

## 3. Secrets, then deploy

```bash
fly secrets set --app temporal-workshop-authentik \
  AUTHENTIK_SECRET_KEY="$(openssl rand -base64 48)" \
  AUTHENTIK_SAML_KEY="$(cat saml.key)" \
  AUTHENTIK_SAML_CERT="$(cat saml.crt)"

fly deploy --app temporal-workshop-authentik --config services/authentik/fly.toml
```

**`AUTHENTIK_SECRET_KEY` is not optional**, and skipping it fails quietly. It signs
sessions and cookies, and both processes must share the same value — so without it
you get this, at `level: info`, buried in an otherwise normal-looking boot:

```json
{"event": "Secret key missing, check https://goauthentik.io/docs/installation/.",
 "level": "info", "logger": "authentik.lib.config"}
```

Set it once and never rotate it casually: changing it invalidates every session.

Note also that `fly secrets set` **stages** changes when machines already exist —
"Secrets have been staged, but not set on VMs" means nothing has taken effect until
the next `fly deploy`.

Two processes come up: `server` (UI, API, SAML endpoints) and `worker`. **The
worker is not optional** — it runs migrations, and a deploy without it comes up
against an un-migrated database and fails in ways that do not name the cause.

```bash
fly status --app temporal-workshop-authentik    # both processes, both passing
fly logs --app temporal-workshop-authentik      # watch migrations finish
```

### The initial-setup flow 404s until the worker has run

`/if/flow/initial-setup/` does not exist in a fresh database. It is a **blueprint**,
and blueprints are applied by the **worker** — so until that process has run at
least once, the URL returns 404 and looks like a wrong path or a broken deploy.

`fly status` must show **both** processes started:

```console
 PROCESS │ ID             │ STATE   │ CHECKS
 server  │ e82090dad95048 │ started │ 1 total, 1 passing
 worker  │ 891153b6d35338 │ started │
```

A worker in `stopped` is the usual cause, and a `fly deploy` does not always leave
it running. Start it explicitly and wait — applying blueprints takes a minute or so
after the process comes up:

```bash
fly machine start <worker-machine-id> --app temporal-workshop-authentik

until [ "$(curl -s -o /dev/null -w '%{http_code}' \
  https://temporal-workshop-authentik.fly.dev/if/flow/initial-setup/)" != "404" ]; do sleep 5; done
```

Note that the **server** can be healthy while this is broken: `/-/health/ready/`
returns 200 once the database and Redis are reachable, which says nothing about
whether blueprints were applied. A green health check is not a working Authentik.

Then set the initial password at
`https://temporal-workshop-authentik.fly.dev/if/flow/initial-setup/`.

---

## 4. The SAML provider and application

In the Authentik UI:

1. **Applications → Providers → Create → SAML Provider**
   - ACS URL: the one from Temporal's SSO setup page
   - Issuer / Audience: as Temporal specifies
   - Signing certificate: the one you injected, **not** a newly generated one.
     Check this. It is the single easiest thing to get wrong here, and the failure
     appears weeks later as "SAML stopped working after a redeploy".
   - **NameID Property Mapping: the email one.** This is the other easy mistake.
     Temporal matches an assertion to a Cloud user **by email address**, and the
     portal creates users as `<username>@temporal.workshop` while their Authentik
     *username* is the bare `tao`. Leave the default and Authentik asserts `tao`,
     Temporal finds no user with that address, and the login is rejected with
     nothing in the message pointing at the mapping.
2. **Applications → Create**, bound to that provider.
3. **An API token for the portal.** See below — it is the fiddliest part of this
   step, because a token inherits the permissions of the user it belongs to, and a
   fresh service account has none.

### What `WORKSHOP_DOMAIN` is

**`temporal.workshop`.** It is fixed, it is the default, and you should not change
it.

It builds `<username>@temporal.workshop` for each student's Temporal Cloud user, and
that is all it does. No mail is sent to it or read from it — no MX, no SPF, no DKIM,
no mailbox.

It also does not exist, deliberately. `.workshop` is **not a delegated TLD**: it has
no NS records in the root zone, so the name cannot resolve and cannot be registered
by anyone, ever. Three things follow, and they are the reason for choosing it:

- **It cannot collide with a real Temporal Cloud account.** One email maps to one
  account permanently, which is the constraint this whole design exists to dodge.
- **It cannot capture real logins.** Mapping a domain you actually use — say
  `temporal.io` — would route genuine staff sign-ins through a workshop IdP.
- **Nothing to buy, register or verify**, and every cohort uses the same value, so
  it is one less thing to get wrong.

**One open question for the support ticket:** whether Temporal will map an
IdP domain that does not exist in DNS. Nothing about the mechanism needs it to
resolve, but if support requires proof of ownership, this is where it surfaces —
ask in the same ticket rather than finding out afterwards. The fallback is a
subdomain you do own, `ws.<yours>`, never your apex.

### Getting AUTHENTIK_TOKEN

A token in Authentik is **bound to a user and inherits that user's permissions**.
Creating one is easy; giving it the right permissions is the part that catches
people, because a new service account has none and every call 403s.

**Two different objects look like the answer, and only one works with a Bearer
header.** Authentik tokens carry an `intent`:

| | Auth scheme | Where it comes from |
|---|---|---|
| **API token** (`intent: api`) | `Authorization: Bearer <key>` | Directory → Tokens and App passwords → Create |
| **App password** (`intent: app_password`) | HTTP Basic, `username:key` | The **Create Service Account** dialog |

Create Service Account hands you an *app password*, not an API token. Sent as a
Bearer credential it is rejected with a body that names neither problem:

```json
{"detail": "Token invalid/expired"}
```

That is a third distinct failure, separate from the two above: the header arrived
and the key is simply not an API token.

In the admin interface at `/if/admin/`:

1. **Directory → Users → Create Service Account.** Name it `portal`. Ignore the
   password it shows you — the portal does not use Basic auth.
2. **Directory → Tokens and App passwords → Create**, with **User** = `portal` and
   **Intent** = `API`. Unlike an app password this key stays retrievable: use the
   token row's copy action whenever you need it again.
3. Give the service account the four permissions the portal actually uses. Open it,
   then **Permissions → Assign to user**, and search for these by name:

   | Permission | Used by |
   |---|---|
   | `authentik_core.add_user` | creating a student at join |
   | `authentik_core.view_user` | finding a returning student, counting the cohort |
   | `authentik_core.change_user` | writing cohort and state token as attributes |
   | `authentik_core.reset_user_password` | issuing a password, and resetting on return |

The quick alternative is adding the service account to the built-in **authentik
Admins** group. That works and takes ten seconds, but it is a token that can do
anything to your IdP sitting in a public web service — where the four permissions
above are precisely what the portal needs and nothing else. Take the ten seconds
only if you are demonstrating, not running a cohort.

Then hand it to the portal:

```bash
fly secrets set --app temporal-workshop-portal \
  AUTHENTIK_URL=https://temporal-workshop-authentik.fly.dev \
  AUTHENTIK_TOKEN='<the token>' \
  WORKSHOP_DOMAIN=temporal.workshop \
  WORKSHOP_COHORT=2026-03-melbourne
```

Verify it before a cohort depends on it. **Do not use `curl -f`** — Authentik
answers *every* failure with 403, including no token at all, so the status code
tells you nothing and `-f` throws away the part that does:

```bash
curl -sS -H "Authorization: Bearer $AUTHENTIK_TOKEN" \
  'https://temporal-workshop-authentik.fly.dev/api/v3/core/users/?page_size=1' \
  | head -c 200
```

Read the `detail` field:

| Body | Means |
|---|---|
| `"Authentication credentials were not provided."` | The token is missing, empty or not recognised — check `$AUTHENTIK_TOKEN` is actually set in *this* shell |
| `"Token invalid/expired"` | The key is not an **API** token — most likely the app password from Create Service Account. See the table above |
| `"You do not have permission to perform this action."` | The token is good; its user lacks the four permissions above |
| `{"pagination": …, "results": …}` | Working |

The first is easy to hit by accident: an unset variable expands to an empty string,
`Authorization: Bearer ` is sent, and the result is indistinguishable by status code
from a permissions problem.

---

## 5. The support ticket — one ticket, three asks

SSO is **not self-service**, and this is the long pole. File it as early as you
can, and fold everything in:

1. **Enable SAML**, with the sign-in URL, `saml.crt` **in PEM**, and the IdP domain
   to map.
2. **Raise the namespace quota to 50.** 15 students at a peak of 3 is 45; the
   documented behaviour is that it auto-increases, but that is not something to
   discover on the morning.
3. **Disable social logins**, so there is exactly one login path and nobody lands
   on "Continue with Google".

---

## 6. Verify before you trust it

Three checks, in order of what they cost you if skipped.

**Restore the database from a backup.** Once, deliberately, before the first
cohort. It holds every registration and nothing else can rebuild it. An untested
backup is not a backup.

```bash
fly mpg backup list "$CLUSTER"
fly mpg restore "$CLUSTER" --backup-id <id>   # restores into a NEW cluster
```

Restore provisions a **new** cluster and leaves the source untouched, so the test
is non-destructive — and the restored cluster is **billed separately**, so destroy
it once you have confirmed it came back with your data:

```bash
fly mpg destroy <restored-cluster-id>
```

**Complete one SAML login end to end**, with an account created through the portal
and never sent an invitation email. This confirms the no-mail design on your
account rather than on the docs.

**Redeploy and log in again.** This is what proves step 1 worked — if SAML still
works after `fly deploy`, the certificate came from your secret rather than from
Authentik's first boot.

---

## When it breaks

| Symptom | Usually |
|---|---|
| `/-/health/ready/` never passes | Database or Redis unreachable — check those variables first |
| `/if/flow/initial-setup/` returns 404 | The worker has not run, so blueprints were never applied. `fly status`, then `fly machine start` |
| Lost the database password | `fly ssh console -a <app> -C "printenv DATABASE_URL"`. See *Getting the database password* |
| `Secret key missing` in the logs | `AUTHENTIK_SECRET_KEY` is unset. Step 3 — and it is `level: info`, so it does not look like an error |
| `Redis Connection failed … localhost:6379` | You set `AUTHENTIK_REDIS__URL`, which does not exist. Split it into `__HOST`/`__PORT`/`__USERNAME`/`__PASSWORD` |
| Secrets set, but nothing changed | They were **staged**. `fly secrets set` does not restart existing machines; `fly deploy` does |
| SAML worked, then stopped after a deploy | The provider is using a generated certificate, not `AUTHENTIK_SAML_CERT`. Step 4.1 |
| Portal join fails with 403 | Read the body, not the code. Authentik returns 403 for a missing token *and* for missing permissions — `detail` distinguishes them. See *Getting AUTHENTIK_TOKEN* |
| Login succeeds, Temporal rejects it | Either the assertion carries the username rather than the email (NameID mapping, step 4.1), or the Cloud user was never created — check the student's `cloudUser` attribute in Authentik |
| Everything is down at 09:00 | There is no fallback. This is the accepted risk in DESIGN.md, *Open risks* |
