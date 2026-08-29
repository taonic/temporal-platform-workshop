'use server';

import { config } from '@/config';
import { participantToken } from '@/lib/auth';
import { verifyCode } from '@/lib/link';
import {
  countCohort,
  createUser,
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
  password?: string;
  stateToken?: string;
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
  const stateToken = participantToken(username);

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
      await updateAttributes(existing.pk, { ...existing.attributes, cohort, stateToken });
      return { returning: true, username, password, stateToken, labUrl: labUrl(username, stateToken) };
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

    const user = await createUser(username, { cohort, stateToken, cloudUser: false });
    const password = await setPassword(user.pk);

    // The Cloud user must exist before a SAML login can succeed — Temporal does
    // not create accounts just-in-time. Global Admin, per the identity matrix:
    // students must see namespaces their platform's service account created.
    await createCloudUser(`${username}@${cfg.WORKSHOP_DOMAIN}`);
    await updateAttributes(user.pk, { cohort, stateToken, cloudUser: true });

    return { username, password, stateToken, labUrl: labUrl(username, stateToken) };
  } catch (err) {
    // Say what broke. "Join failed" sends a student to the instructor; "Authentik
    // is unreachable" tells the instructor what to fix.
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function labUrl(username: string, token: string): string {
  const p = new URLSearchParams({ k: config().PORTAL_LINK_CODE, u: username, t: token });
  return `/lab/1?${p.toString()}`;
}
