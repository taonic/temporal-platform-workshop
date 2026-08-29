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
| A domain | Identifier namespace only. **No MX, no mailbox** — nothing sends mail |
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
fly mpg attach temporal-workshop-authentik-db --app temporal-workshop-authentik

# Authentik's task queue. Small: the workload is a handful of logins.
fly redis create --name temporal-workshop-authentik-redis --region syd
```

`fly mpg attach` sets `DATABASE_URL`; `fly redis create` prints a `REDIS_URL`.
Authentik wants them under its own names:

```bash
fly secrets set --app temporal-workshop-authentik \
  AUTHENTIK_POSTGRESQL__HOST="$(fly mpg status temporal-workshop-authentik-db --json | jq -r .Hostname)" \
  AUTHENTIK_POSTGRESQL__NAME=authentik \
  AUTHENTIK_POSTGRESQL__USER=authentik \
  AUTHENTIK_POSTGRESQL__PASSWORD='<from fly mpg>' \
  AUTHENTIK_REDIS__URL='<the redis:// url fly printed>'
```

---

## 3. Secrets, then deploy

```bash
fly secrets set --app temporal-workshop-authentik \
  AUTHENTIK_SECRET_KEY="$(openssl rand -base64 48)" \
  AUTHENTIK_SAML_KEY="$(cat saml.key)" \
  AUTHENTIK_SAML_CERT="$(cat saml.crt)"

fly deploy --app temporal-workshop-authentik --config services/authentik/fly.toml
```

Two processes come up: `server` (UI, API, SAML endpoints) and `worker`. **The
worker is not optional** — it runs migrations, and a deploy without it comes up
against an un-migrated database and fails in ways that do not name the cause.

```bash
fly status --app temporal-workshop-authentik    # both processes, both passing
fly logs --app temporal-workshop-authentik      # watch migrations finish
```

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
2. **Applications → Create**, bound to that provider.
3. **Directory → Tokens → Create** — an API token for the portal.
   It needs to create users, set passwords and patch attributes; nothing more.

```bash
fly secrets set --app temporal-workshop-portal \
  AUTHENTIK_URL=https://temporal-workshop-authentik.fly.dev \
  AUTHENTIK_TOKEN='<the token>' \
  WORKSHOP_DOMAIN=<your domain> \
  WORKSHOP_COHORT=2026-03-melbourne
```

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
fly mpg backup list --app temporal-workshop-authentik-db
fly mpg backup restore <id> --app temporal-workshop-authentik-db
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
| `/-/health/ready/` never passes | The worker is not running, so migrations never ran. `fly status` |
| SAML worked, then stopped after a deploy | The provider is using a generated certificate, not `AUTHENTIK_SAML_CERT`. Step 4.1 |
| Portal join fails with 403 | The API token lacks user-create permission, or was rotated |
| Login succeeds, Temporal rejects it | The Cloud user does not exist. The portal creates it at join; check `WORKSHOP_DOMAIN` matches the IdP domain in the ticket |
| Everything is down at 09:00 | There is no fallback. This is the accepted risk in DESIGN.md, *Open risks* |
