import { config } from '@/config';

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
 */

export class AuthentikError extends Error {}

export interface WorkshopUser {
  pk: number;
  username: string;
  attributes: { cohort?: string; stateToken?: string; cloudUser?: boolean };
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

export async function findUser(username: string): Promise<WorkshopUser | undefined> {
  const r = await api<{ results: WorkshopUser[] }>(
    `/core/users/?username=${encodeURIComponent(username)}`,
  );
  return r.results.find((u) => u.username === username);
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
  username: string,
  attributes: WorkshopUser['attributes'],
): Promise<WorkshopUser> {
  const cfg = config();
  return api<WorkshopUser>('/core/users/', {
    method: 'POST',
    body: JSON.stringify({
      username,
      name: username,
      email: `${username}@${cfg.WORKSHOP_DOMAIN}`,
      is_active: true,
      attributes,
    }),
  });
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
