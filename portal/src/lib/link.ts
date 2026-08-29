import { timingSafeEqual } from 'node:crypto';
import { config } from '@/config';

/**
 * The workshop link is one configured code, PORTAL_LINK_CODE. There is no link
 * table and nothing derived at runtime -- every process reads the same value from
 * its environment.
 *
 * Two design rounds are worth recording, because the training portal this is
 * lifted from tried both the other way first:
 *
 *  1. It used to be an HMAC of the calendar day, which expired every link at
 *     midnight. Sandbox access outlasts a day, so students were locked out
 *     halfway through their own window and someone had to re-paste a new link.
 *     Expiry became an ACTION rather than a clock.
 *  2. It was then an HMAC of a secret with the day dropped -- but with no
 *     rotation left, hashing a secret to produce one fixed string bought nothing
 *     over configuring that string. The code IS the configuration.
 *
 * Retiring every outstanding link is therefore one command:
 *
 *     fly secrets set PORTAL_LINK_CODE=<new>
 *
 * Deployed as a secret rather than plain config. Six characters projected onto a
 * wall are not much of a secret, but they are the only thing between a stranger
 * and the portal, and a value in git is a value that outlives the workshop it was
 * for.
 *
 * Why this is separate from PORTAL_SHARED_SECRET, which is the more interesting
 * question here: that secret is deliberately the same value the Terraform state
 * service uses, so that one HMAC scheme produces every per-participant token in
 * the workshop. Rotating it to retire portal links would therefore also break
 * every student's state backend auth mid-workshop. Two values, two jobs: the code
 * retires links, the secret binds identity, and neither rotation breaks the other.
 *
 * This gates who may OPEN the portal. It is not on its own an access control --
 * the per-participant token is what stops one student reading another's progress,
 * and Okta and the Cloud's own RBAC are what actually protect anything.
 */

export function currentCode(): string {
  return config().PORTAL_LINK_CODE;
}

export function verifyCode(candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  // Case-insensitive: the code gets typed off a projected screen, and it has no
  // uppercase characters to lose.
  const supplied = candidate.trim().toLowerCase();
  const expected = currentCode();
  // Length check first -- timingSafeEqual throws on mismatched lengths.
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

/**
 * The query string a student's personalised link carries.
 *
 * `u` rather than `p`: the identifier is the username the student chose, not an
 * Instruqt participant id. The lab page still accepts `p` so that links printed by
 * an older sandbox keep working for the length of one cohort.
 */
export function labQuery(username: string, token: string): string {
  const p = new URLSearchParams({ k: currentCode(), u: username, t: token });
  return `?${p.toString()}`;
}
