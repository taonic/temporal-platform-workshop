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
 * credential in Vault -- is graded by the Instruqt check scripts instead, and the
 * portal says so rather than pretending.
 */
const Schema = z.object({
  /** Read-only-ish Cloud credential belonging to the instructor, not a student. */
  TEMPORAL_CLOUD_API_KEY: z.string().min(1, 'TEMPORAL_CLOUD_API_KEY is required'),

  /** Account id, for rendering fully qualified namespace ids in snippets. */
  PORTAL_ACCOUNT_ID: z.string().min(1, 'PORTAL_ACCOUNT_ID is required'),

  /**
   * Per-participant view tokens are derived from this, with the same HMAC scheme
   * the Terraform state service uses. One secret, one scheme, two services --
   * rather than a second list of tokens to keep in sync with the first.
   */
  PORTAL_SHARED_SECRET: z.string().min(16, 'PORTAL_SHARED_SECRET must be at least 16 characters'),

  /**
   * The instructor view lists every participant. It gets its own long-lived token
   * rather than sharing the students' -- a student link gets pasted into chat.
   */
  PORTAL_INSTRUCTOR_TOKEN: z.string().min(16).optional(),

  PORTAL_COHORT_SIZE: z.coerce.number().int().positive().default(15),
  PORTAL_SANDBOX_URL: z.string().url().optional(),

  /** Override for non-production Cloud environments. */
  PORTAL_CLOUD_API_BASE: z.string().url().default('https://saas-api.tmprl.cloud'),
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
