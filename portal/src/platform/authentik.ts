import { config, workshopEmail } from '@/config';

/**
 * Authentik, used for two jobs at once.
 *
 * It is the SAML IdP students authenticate to, and it is the portal's datastore:
 * a student's cohort, state token and Cloud-user status live as *user attributes*
 * rather than in a table of our own. One store, reached through the API — never by
 * writing Authentik's schema directly, because it migrates on every upgrade.
 *
 * Registration is first-come, first-served, and the race is a uniqueness
 * constraint rather than a lock: Authentik rejects a duplicate username, and a
 * duplicate that belongs to the same person is a *return*, not a conflict.
 *
 * Two names, deliberately, and it matters which is which:
 *
 *   handle    the bare name the student typed -- `tao`. The workshop identity.
 *             Namespaces, Vault paths, tfstate keys and the tag the grader reads
 *             are all named after it, which is why it is constrained to the
 *             namespace alphabet.
 *   username  the full address -- `tao@temporal.workshop`. Authentik's username
 *             field, because that is what the SAML assertion carries to Temporal
 *             Cloud. Temporal creates nothing just-in-time, so an assertion
 *             naming a bare handle arrives for a user the account has never seen
 *             and is rejected at the last possible moment: at a student's first
 *             login, in front of the room.
 *
 * `name` holds the handle, so the Authentik UI stays readable by a human.
 */

export class AuthentikError extends Error {}

export interface WorkshopUser {
  pk: number;
  /** The full address. See the note above on handle vs username. */
  username: string;
  /** Optional because Authentik will happily hold a user without one; see ensureIdentity. */
  email?: string;
  attributes: { cohort?: string; viewToken?: string; cloudUser?: boolean };
}

function creds(): { url: string; token: string } {
  const cfg = config();
  if (!cfg.AUTHENTIK_URL || !cfg.AUTHENTIK_TOKEN) {
    throw new AuthentikError(
      'AUTHENTIK_URL and AUTHENTIK_TOKEN are not set, so nobody can join. ' +
        'The portal reads them at point of use rather than at startup, so the lab ' +
        'pages keep rendering without them.',
    );
  }
  return { url: cfg.AUTHENTIK_URL.replace(/\/$/, ''), token: cfg.AUTHENTIK_TOKEN };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, token } = creds();
  const res = await fetch(`${url}/api/v3${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new AuthentikError(`Authentik ${init?.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/**
 * Find a student by the handle they typed.
 *
 * Accepts both conventions on the way back: the address, which is what this
 * provisions now, and the bare handle, which is what accounts made before it did.
 * A returning student whose account predates the change must find it — the
 * alternative is a *second* account under the same handle, with the SAML login
 * pointing at whichever one loses.
 *
 * `search` spans username, name and email, so one request covers both. It is a
 * substring match, so what comes back is a candidate set and not an answer:
 * searching `tao` also returns `tao2`, and the admin whose email merely contains
 * it. The exact re-check is what makes the result trustworthy.
 */
export async function findUser(handle: string): Promise<WorkshopUser | undefined> {
  const email = workshopEmail(handle);
  const r = await api<{ results: WorkshopUser[] }>(
    `/core/users/?search=${encodeURIComponent(handle)}`,
  );
  return r.results.find((u) => u.username === email || u.username === handle);
}

/** How many people have joined this cohort. The registration cap reads this. */
export async function countCohort(cohort: string): Promise<number> {
  const q = encodeURIComponent(JSON.stringify({ cohort }));
  const r = await api<{ pagination?: { count: number }; results: WorkshopUser[] }>(
    `/core/users/?attributes=${q}`,
  );
  return r.pagination?.count ?? r.results.length;
}

export async function createUser(
  handle: string,
  attributes: WorkshopUser['attributes'],
): Promise<WorkshopUser> {
  const email = workshopEmail(handle);
  return api<WorkshopUser>('/core/users/', {
    method: 'POST',
    body: JSON.stringify({
      username: email,
      name: handle,
      email,
      is_active: true,
      attributes,
    }),
  });
}

/**
 * The group every workshop account belongs to.
 *
 * Membership is not decoration: it is what the Authentik side binds access to, so
 * an account outside it authenticates and then gets nowhere. That failure lands at
 * the SAML redirect — one hop from its cause, and in front of the room.
 */
const PORTAL_GROUP = 'portal';

/**
 * Put the user in the portal group. Idempotent.
 *
 * `add_user` on an existing member is a no-op, so this runs on the returning path
 * as well as at creation — an account made by hand in the Authentik UI, or one
 * that predates the group, converges rather than staying silently outside it.
 *
 * A missing group is fatal, deliberately. The alternative is a join that reports
 * success and hands over a password that cannot get anyone in.
 */
export async function ensureGroup(user: WorkshopUser): Promise<void> {
  // Exact filter, not a substring search: `name` on /core/groups/ matches whole.
  const groups = await api<{ results: { pk: string; name: string }[] }>(
    `/core/groups/?name=${encodeURIComponent(PORTAL_GROUP)}`,
  );
  const group = groups.results.find((g) => g.name === PORTAL_GROUP);
  if (!group) {
    throw new AuthentikError(
      `Authentik has no group named "${PORTAL_GROUP}", so ${user.username} cannot be ` +
        'placed in it. Create it under Directory -> Groups. Every workshop account ' +
        'belongs to it, and access is bound to it -- without it a student signs in ' +
        'and gets nowhere.',
    );
  }
  // 204 on success. `pk` here is the USER's integer pk, not the group's uuid.
  await api<void>(`/core/groups/${group.pk}/add_user/`, {
    method: 'POST',
    body: JSON.stringify({ pk: user.pk }),
  });
}

/**
 * Guarantee username and email are both `<handle>@<WORKSHOP_DOMAIN>`, and return it.
 *
 * A no-op for anyone this portal just created, and the repair for anyone it did
 * not: an account made by hand in the Authentik UI, one left behind by an older
 * WORKSHOP_DOMAIN, or one provisioned under the earlier convention where the
 * username was the bare handle. Those users authenticate fine and then fail at
 * Temporal Cloud, because the assertion names somebody the account has never
 * seen — a failure that surfaces one hop away from its cause, at the worst
 * possible moment.
 *
 * Run on the returning path too, not only at creation, so every join
 * re-establishes the guarantee instead of trusting that the first one held.
 */
export async function ensureIdentity(user: WorkshopUser, handle: string): Promise<string> {
  const email = workshopEmail(handle);
  const patch: Record<string, string> = {};
  if (user.username !== email) patch.username = email;
  if (user.email !== email) patch.email = email;
  if (Object.keys(patch).length === 0) return email;
  await api<void>(`/core/users/${user.pk}/`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return email;
}

/**
 * Set a password and return it.
 *
 * Called on join *and* on return. A password shown once and then lost would lock
 * someone out of an identity they own, with no recovery path — so returning with
 * the same username resets it rather than refusing.
 */
export async function setPassword(pk: number): Promise<string> {
  // Readable rather than maximally random: it gets typed off a screen once, into
  // a login form, on identities that are deleted at teardown.
  const password = `ws-${Math.random().toString(36).slice(2, 8)}-${Math.random().toString(36).slice(2, 8)}`;
  await api<void>(`/core/users/${pk}/set_password/`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  return password;
}

export async function updateAttributes(
  pk: number,
  attributes: WorkshopUser['attributes'],
): Promise<void> {
  await api<void>(`/core/users/${pk}/`, {
    method: 'PATCH',
    body: JSON.stringify({ attributes }),
  });
}
