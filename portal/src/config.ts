import { z } from 'zod';

/**
 * Configuration, validated once at first use.
 *
 * The portal has no database, and -- more importantly -- it cannot reach the
 * control planes the students build. Each sandbox runs its own Temporal dev
 * server and its own platform worker, and nothing central has ingress to them.
 *
 * The one surface every student shares is the Temporal Cloud account. So that is
 * what the portal reads: namespaces, their tags, and service accounts. The
 * reconciler writes progress into namespace tags precisely so that this is
 * possible. Anything that only exists inside a sandbox -- a pod on k3s, a
 * credential in Vault -- is graded by the scripts in instruqt/checks/ instead, and
 * the portal says so rather than pretending.
 */
const Schema = z.object({
  /**
   * Read-only Cloud credential belonging to the instructor, not a student.
   *
   * Optional HERE and required at the point of use, deliberately. Everything that
   * does not touch the Cloud -- verifying a link code, rendering lab material --
   * must keep working without it, because a single config() that threw on any
   * missing value turned an absent Cloud key into a 500 on every page. A missing
   * credential should break the checkpoints panel and nothing else.
   */
  TEMPORAL_CLOUD_API_KEY: z.string().optional(),

  /** Account id, for rendering fully qualified namespace ids in snippets. */
  PORTAL_ACCOUNT_ID: z.string().min(1, 'PORTAL_ACCOUNT_ID is required'),

  /**
   * The code that opens the portal. Rotating it retires every outstanding link at
   * once; see src/lib/link.ts for why it is a plain code rather than a hash, and
   * why it is deliberately not the same value as PORTAL_SHARED_SECRET.
   *
   * Lower-cased and constrained to typeable characters, because it gets read off
   * a projected screen.
   */
  PORTAL_LINK_CODE: z
    .string()
    .min(6, 'PORTAL_LINK_CODE must be at least 6 characters')
    .transform((v) => v.trim().toLowerCase())
    .refine((v) => /^[a-z0-9-]+$/.test(v), 'PORTAL_LINK_CODE must be lower-case letters, digits or dashes'),

  /**
   * Per-participant lab-page tokens are derived from this:
   *
   *   token = HMAC-SHA256(secret, username)[:40]
   *
   * Derived rather than stored, so there is no list to keep in sync.
   *
   * Distinct from PORTAL_LINK_CODE on purpose: rotating a link retires outstanding
   * portal links, and it must not also invalidate a bookmark someone is mid-lab
   * with for a different reason.
   */
  PORTAL_SHARED_SECRET: z.string().min(16, 'PORTAL_SHARED_SECRET must be at least 16 characters'),

  /**
   * The instructor view lists every student. It gets its own long-lived token
   * rather than sharing the students' -- a student link gets pasted into chat.
   *
   * Eight characters is a floor against a typo, not a security bound. It gates a
   * read-only view of who has provisioned what, inside a workshop that lasts an
   * afternoon; the Cloud's own RBAC is what protects anything that matters.
   */
  PORTAL_INSTRUCTOR_TOKEN: z.string().min(8).optional(),

  PORTAL_COHORT_SIZE: z.coerce.number().int().positive().default(15),
  PORTAL_SANDBOX_URL: z.string().url().optional(),

  /**
   * Authentik, which is both the SAML IdP and the portal's own datastore: a
   * student's username, cohort and view token live as user attributes, so there
   * is no second database and nothing writes Authentik's schema behind its back.
   */
  AUTHENTIK_URL: z.string().url().optional(),
  AUTHENTIK_TOKEN: z.string().optional(),
  /**
   * The identifier namespace for `<username>@<domain>`. No MX, no mailbox, and it
   * never resolves: `.workshop` is not a delegated TLD, so this name cannot be
   * registered by anyone and cannot collide with a real Temporal Cloud account.
   * That is the point -- see DESIGN.md, *Identity via Authentik*.
   */
  WORKSHOP_DOMAIN: z
    .string()
    .default('temporal.workshop')
    // Normalised rather than trusted. A stray `@`, a trailing dot or an upper-case
    // letter here does not fail loudly -- it silently provisions students at an
    // address the SAML assertion will not match, and the first symptom is a login
    // that bounces on workshop morning.
    .transform((v) => v.trim().toLowerCase().replace(/^@+/, '').replace(/\.+$/, ''))
    .refine(
      (v) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(v),
      'WORKSHOP_DOMAIN must be a bare domain like temporal.workshop — no @, no scheme, no path',
    ),
  /** Tags every namespace this cohort creates, and scopes teardown. */
  WORKSHOP_COHORT: z.string().default('local'),

  /**
   * The region a student's control plane is provisioned in, pre-filled into the
   * `workshop init` line the join screen prints.
   *
   * Config rather than a constant because it moves with the venue -- a Sydney
   * cohort provisioning into us-west-2 works, and is slow enough all afternoon
   * that somebody will blame the workshop. `workshop` derives the gRPC
   * endpoint from it, so this one value sets both.
   */
  WORKSHOP_CONTROL_REGION: z
    .string()
    .default('aws-ap-southeast-2')
    .refine(
      (v) => /^(aws|gcp|azure)-[a-z0-9-]+$/.test(v),
      'WORKSHOP_CONTROL_REGION must look like aws-ap-southeast-2 — cloud, then region',
    ),

  /** Override for non-production Cloud environments. */
  PORTAL_CLOUD_API_BASE: z.string().url().default('https://saas-api.tmprl.cloud'),

  /**
   * Where a student goes to sign in. Shown on the join screen as the call to
   * action, next to the credentials they were just handed — the alternative is
   * fifteen people asking what URL to open while holding a password that is
   * displayed once.
   *
   * Separate from PORTAL_CLOUD_API_BASE: that is the Ops API this portal reads,
   * and it is not a page anyone signs in to.
   */
  PORTAL_CLOUD_LOGIN_URL: z.string().url().default('https://cloud.temporal.io'),

  /**
   * Ops API version, sent as the temporal-cloud-api-version header.
   *
   * Pinned, because an unpinned API version is a workshop that breaks on someone
   * else's release schedule. Configurable, because needing a rebuild to bump a
   * compatibility header is the wrong kind of pinned.
   */
  PORTAL_CLOUD_API_VERSION: z.string().default('v0.19.1'),
});

export type Config = z.infer<typeof Schema>;

let cached: Config | undefined;

export function config(): Config {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    // Fail loudly at first use rather than rendering a page that half works.
    throw new Error(
      'portal configuration is invalid:\n' +
        parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  }
  cached = parsed.data;
  return cached;
}

/**
 * A student's workshop address: `<username>@<WORKSHOP_DOMAIN>`.
 *
 * The single place that string is spelled out. Authentik provisions the user with
 * it, Temporal Cloud provisions the user with it, and the SAML assertion carries
 * it between them — three producers of one identifier, which is exactly the shape
 * that drifts. Anything that needs the address calls this rather than
 * re-concatenating, so "always ends with the configured domain" is true by
 * construction instead of by convention.
 */
export function workshopEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${config().WORKSHOP_DOMAIN}`;
}
