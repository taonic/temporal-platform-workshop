'use server';

import { config } from '@/config';
import { participantToken } from '@/lib/auth';
import { verifyCode } from '@/lib/link';
import {
  countCohort,
  createUser,
  ensureGroup,
  ensureIdentity,
  findUser,
  setPassword,
  updateAttributes,
} from '@/platform/authentik';
import { createCloudUser } from '@/platform/cloud';

const USERNAME = /^[a-z][a-z0-9-]{1,13}$/;

export interface JoinResult {
  error?: string;
  returning?: boolean;
  username?: string;
  /** `<username>@<WORKSHOP_DOMAIN>` — the identity Temporal Cloud knows them by. */
  email?: string;
  password?: string;
  /** Per-participant lab-page token. Not a credential for anything else. */
  viewToken?: string;
  labUrl?: string;
}

/**
 * Join the workshop, or come back to it.
 *
 * First in, first served, and the race is a uniqueness constraint rather than a
 * lock: Authentik rejects a duplicate username. What that leaves is the question
 * of what a duplicate *means*, and the answer is the whole recovery story — the
 * same username is a **return**, not a conflict. Close the tab, come back, type
 * the same name, get your slot back with a fresh password.
 *
 * The alternative, rejecting duplicates outright, locks a student out of an
 * identity they own the moment they lose the tab. On throwaway workshop
 * identities that trade is not close.
 */
export async function join(code: string, raw: string): Promise<JoinResult> {
  if (!verifyCode(code)) return { error: 'That workshop link has been retired. Ask your instructor.' };

  const username = raw.trim().toLowerCase();
  if (!USERNAME.test(username)) {
    return {
      error:
        'Username must be 2-14 characters: lower-case letters, digits and dashes, starting with a ' +
        'letter. It is not cosmetic — it becomes part of a Temporal Cloud namespace name, and ' +
        'those are capped at 39 characters of exactly this alphabet.',
    };
  }

  const cfg = config();
  const cohort = cfg.WORKSHOP_COHORT;
  const viewToken = participantToken(username);

  try {
    const existing = await findUser(username);

    // Returning. Reset rather than refuse: a password shown once and lost would
    // otherwise strand someone on an identity that is genuinely theirs.
    if (existing) {
      if (existing.attributes?.cohort && existing.attributes.cohort !== cohort) {
        return {
          error: `The name "${username}" belongs to a different cohort. Pick another one.`,
        };
      }
      const password = await setPassword(existing.pk);
      // Converge the account on the address BEFORE the Cloud user is keyed off
      // it. An account made by hand, or under the older bare-handle convention,
      // otherwise keeps whatever it has -- and provisions a second Cloud identity
      // under the wrong name rather than repairing the one that exists.
      const email = await ensureIdentity(existing, username);
      await ensureGroup(existing);
      // Ensure the Cloud user on this path too, NOT only on first join. Creating
      // the Authentik user and the Cloud user are two calls, and anything that
      // fails between them leaves a half-made account -- which then takes this
      // branch forever and never gets its Cloud side. That is not hypothetical:
      // it is what an invalid account role did, silently, until someone noticed
      // the SAML login had nothing to log in to.
      await ensureCloudUser(email, existing.attributes);
      await updateAttributes(existing.pk, {
        ...existing.attributes,
        cohort,
        viewToken,
        cloudUser: true,
      });
      return {
        returning: true,
        username,
        email,
        password,
        viewToken,
        labUrl: labUrl(username, viewToken),
      };
    }

    // The cap is checked here rather than left to the namespace quota. "The
    // workshop is full, see the instructor" at join is a conversation; running
    // out of namespaces at 11:00 is an outage that lands on somebody else.
    const joined = await countCohort(cohort);
    if (joined >= cfg.PORTAL_COHORT_SIZE) {
      return {
        error:
          `This workshop is full (${joined} of ${cfg.PORTAL_COHORT_SIZE}). See your instructor — ` +
          'the limit is the account\'s namespace quota, not an arbitrary number.',
      };
    }

    const user = await createUser(username, { cohort, viewToken, cloudUser: false });
    const password = await setPassword(user.pk);
    // createUser already set this address; reading it back through the same
    // guarantee means both join paths derive the Cloud identity one way.
    const email = await ensureIdentity(user, username);
    await ensureGroup(user);
    await ensureCloudUser(email, undefined);
    await updateAttributes(user.pk, { cohort, viewToken, cloudUser: true });

    return { username, email, password, viewToken, labUrl: labUrl(username, viewToken) };
  } catch (err) {
    // Say what broke. "Join failed" sends a student to the instructor; "Authentik
    // is unreachable" tells the instructor what to fix.
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Create the Temporal Cloud user, unless it is already known to exist.
 *
 * Temporal does not create accounts just-in-time, so this must succeed before the
 * student's first SAML login -- the assertion arrives for an address Temporal has
 * never seen and is rejected. `createCloudUser` treats "already exists" as success,
 * so calling it again costs one request and repairs a half-made account.
 */
async function ensureCloudUser(
  email: string,
  attributes: { cloudUser?: boolean } | undefined,
): Promise<void> {
  if (attributes?.cloudUser === true) return;
  await createCloudUser(email);
}

function labUrl(username: string, token: string): string {
  const p = new URLSearchParams({ k: config().PORTAL_LINK_CODE, u: username, t: token });
  return `/lab/1?${p.toString()}`;
}
