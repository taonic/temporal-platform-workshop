import { z } from 'zod';
import { config } from '@/config';

/**
 * Temporal Cloud Ops API, over HTTP.
 *
 * Only the reads the portal needs, and every one of them is defensively parsed:
 * an API shape that changes should surface as a legible error on the page, not as
 * a stack trace or -- worse -- a checkpoint that silently goes red.
 */

const Namespace = z.object({
  namespace: z.string().optional(),
  state: z.string().optional(),
  /** Tags live on the Namespace, not on its spec. This is what makes the portal possible. */
  tags: z.record(z.string()).default({}),
  spec: z
    .object({
      name: z.string().optional(),
      regions: z.array(z.string()).default([]),
      retentionDays: z.number().optional(),
      apiKeyAuth: z.object({ enabled: z.boolean().optional() }).partial().optional(),
    })
    .default({}),
});

const ServiceAccount = z.object({
  id: z.string().optional(),
  state: z.string().optional(),
  spec: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      access: z
        .object({
          accountAccess: z.object({ role: z.string().optional() }).partial().optional(),
          namespaceScopedAccess: z
            .object({ namespaceId: z.string().optional(), permission: z.string().optional() })
            .partial()
            .optional(),
          namespaceAccesses: z.record(z.unknown()).optional(),
        })
        .partial()
        .optional(),
    })
    .default({}),
});

export type CloudNamespace = z.infer<typeof Namespace>;
export type CloudServiceAccount = z.infer<typeof ServiceAccount>;

const NamespacesPage = z.object({
  namespaces: z.array(Namespace).default([]),
  nextPageToken: z.string().optional(),
});

const ServiceAccountsPage = z.object({
  serviceAccounts: z.array(ServiceAccount).default([]),
  nextPageToken: z.string().optional(),
});

export class CloudError extends Error {}

async function get<T>(path: string, schema: z.ZodType<T>, params: Record<string, string> = {}): Promise<T> {
  const cfg = config();
  if (!cfg.TEMPORAL_CLOUD_API_KEY) {
    throw new CloudError(
      'TEMPORAL_CLOUD_API_KEY is not set, so the portal cannot read the Cloud account. ' +
        'Lab material still renders; checkpoints cannot. See .env.example.',
    );
  }
  const url = new URL(cfg.PORTAL_CLOUD_API_BASE + path);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${cfg.TEMPORAL_CLOUD_API_KEY}`,
      'temporal-cloud-api-version': cfg.PORTAL_CLOUD_API_VERSION,
      accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new CloudError(
      `Cloud Ops API ${res.status} on ${path}: ${body.slice(0, 200) || res.statusText}` +
        (res.status === 401 || res.status === 403
          ? '\n\nThe portal\'s own credential is broken -- expired, revoked, or the identity was deleted.'
          : ''),
    );
  }

  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    throw new CloudError(
      `Cloud Ops API returned an unexpected shape on ${path}: ` +
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return parsed.data;
}

async function paginate<T>(
  path: string,
  schema: z.ZodType<{ nextPageToken?: string } & Record<string, unknown>>,
  pick: (page: never) => T[],
): Promise<T[]> {
  const out: T[] = [];
  let token: string | undefined;
  // Bounded: a runaway loop against a paginated API is a bill, not a bug report.
  for (let page = 0; page < 20; page++) {
    const body = await get(path, schema, { pageSize: '100', pageToken: token ?? '' });
    out.push(...pick(body as never));
    token = body.nextPageToken;
    if (!token) break;
  }
  return out;
}

/**
 * Create a Temporal Cloud user so a SAML login can succeed.
 *
 * Temporal does not create accounts just-in-time, so a user must exist before
 * first sign-in. Students choose their own username at join time, which is why
 * nothing can pre-provision these in Terraform — and why the portal holds an
 * account-owner key. That is the second elevated credential this design otherwise
 * avoids, accepted knowingly; see DESIGN.md, *Open risks*.
 *
 * Global Admin, per the identity matrix: a student must be able to see namespaces
 * their platform's service account created, from challenge 2 onward.
 *
 * Idempotent by treating "already exists" as success — a returning student runs
 * through this path again and should not see an error for having been here.
 */
export async function createCloudUser(email: string): Promise<void> {
  const cfg = config();
  if (!cfg.TEMPORAL_CLOUD_API_KEY) {
    throw new CloudError('TEMPORAL_CLOUD_API_KEY is not set, so the portal cannot create the Cloud user.');
  }
  const res = await fetch(cfg.PORTAL_CLOUD_API_BASE + '/cloud/users', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cfg.TEMPORAL_CLOUD_API_KEY}`,
      'temporal-cloud-api-version': cfg.PORTAL_CLOUD_API_VERSION,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    cache: 'no-store',
    // ROLE_ADMIN, not 'admin'. `role` is a proto enum and serialises by name in
    // JSON; the bare string was `role_deprecated`, removed after API v0.3.0 and
    // rejected by the version this portal pins as `invalid account role`.
    body: JSON.stringify({
      spec: { email, access: { accountAccess: { role: 'ROLE_ADMIN' } } },
    }),
  });
  if (res.ok) return;

  const body = await res.text().catch(() => '');
  if (res.status === 409 || /already exists/i.test(body)) return;
  throw new CloudError(
    `Cloud Ops API ${res.status} creating user ${email}: ${body.slice(0, 200) || res.statusText}` +
      (res.status === 401 || res.status === 403
        ? "\n\nCreating a user is an account-admin operation. The portal's key may be scoped too narrowly, or expired."
        : ''),
  );
}

export async function listNamespaces(): Promise<CloudNamespace[]> {
  return paginate('/cloud/namespaces', NamespacesPage, (p: { namespaces: CloudNamespace[] }) => p.namespaces);
}

export async function listServiceAccounts(): Promise<CloudServiceAccount[]> {
  return paginate(
    '/cloud/service-accounts',
    ServiceAccountsPage,
    (p: { serviceAccounts: CloudServiceAccount[] }) => p.serviceAccounts,
  );
}

/** The account inventory, read once per request and shared by every checkpoint. */
export interface Inventory {
  namespaces: CloudNamespace[];
  serviceAccounts: CloudServiceAccount[];
}

export async function readInventory(): Promise<Inventory> {
  // In parallel: the two reads are independent and the page waits on both.
  const [namespaces, serviceAccounts] = await Promise.all([listNamespaces(), listServiceAccounts()]);
  return { namespaces, serviceAccounts };
}

export function namespaceName(ns: CloudNamespace): string {
  return ns.spec.name ?? ns.namespace?.split('.')[0] ?? '';
}
