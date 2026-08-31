import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '@/config';

/**
 * A participant's view token, derived rather than stored.
 *
 * Derived from one shared secret rather than stored, so there is no list of
 * tokens to keep in sync and the dev-link script can compute the same value with
 * one openssl call.
 *
 * This is a lab aid, not a security boundary -- it stops a student reading
 * another student's progress by editing a URL, and nothing more. The workshop's
 * real access control is Okta and the Cloud's own RBAC.
 */
export function participantToken(participant: string): string {
  return createHmac('sha256', config().PORTAL_SHARED_SECRET)
    .update(participant)
    .digest('hex')
    .slice(0, 40);
}

export function verifyParticipant(participant: string | null, token: string | null): boolean {
  if (!participant || !token) return false;
  const expected = participantToken(participant);
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

/** The instructor view lists everyone, so it is gated separately. */
export function verifyInstructor(token: string | null | undefined): boolean {
  const expected = config().PORTAL_INSTRUCTOR_TOKEN;
  if (!expected || !token) return false;
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
