import { config } from '@/config';
import type { SnippetContext } from './types';

/**
 * Per-student names, derived from the username the student chose.
 *
 * An earlier design derived them from a leased integer slot, on the belief that
 * Temporal Cloud reserves a namespace name after deletion. It does not -- and the
 * reasoning was circular anyway, since a reserved `ws-7-orders-staging` would burn
 * exactly as `ws-alice-orders-staging` would. Slots are retired; see DESIGN.md,
 * *Names are recyclable*.
 *
 * The spec name is the student's own choice, so these are patterns rather than
 * literals. That is a deliberate difference from the training portal, where the
 * portal chose the name: here the team decides both the username and the spec
 * name, and the platform decides everything downstream of them.
 */
export function snippetContext(username: string, spec?: string): SnippetContext {
  const cfg = config();
  // The spec name is the student's choice, so it can only be substituted once they
  // have made it -- and by then the reconciler has written it into the namespace
  // tags, which is where the portal reads it from. No form, no stored state.
  const name = spec ?? '<spec>';
  return {
    username,
    spec,
    accountId: cfg.PORTAL_ACCOUNT_ID,
    cohort: cfg.WORKSHOP_COHORT,
    region: cfg.WORKSHOP_CONTROL_REGION,
    namespacePattern: `ws-${username}-${name}-<environment>`,
    stagingSuffix: `ws-${username}-${name}-staging`,
    prodSuffix: `ws-${username}-${name}-prod`,
    sandboxUrl: cfg.PORTAL_SANDBOX_URL,
  };
}

/**
 * Matches ws-<username>-<spec>-<env>, the only name shape the platform makes.
 *
 * Both halves are `[a-z][a-z0-9-]*` and the separator is also a hyphen, so this is
 * genuinely ambiguous -- `ws-a-b-c-staging` could split two ways. The environment
 * suffix and the `ws-` prefix are unambiguous; what sits between them is resolved
 * against the username we already know, which is why this takes one.
 */
const NAME = /^ws-(.+)-(staging|prod)$/;

export interface ParsedName {
  username: string;
  spec: string;
  environment: 'staging' | 'prod';
}

export function parsePhysicalName(name: string, username?: string): ParsedName | undefined {
  const m = NAME.exec(name);
  if (!m) return undefined;
  const middle = m[1] as string;
  const environment = m[2] as 'staging' | 'prod';

  if (username) {
    if (middle === username) return undefined; // no spec part: not one of ours
    if (!middle.startsWith(`${username}-`)) return undefined;
    return { username, spec: middle.slice(username.length + 1), environment };
  }

  // Without a username to anchor on, the best we can do is split at the last
  // hyphen -- correct for every single-word spec name, which is all of them in
  // practice, and only used by the instructor view where a wrong split is
  // cosmetic rather than a grading error.
  const cut = middle.lastIndexOf('-');
  if (cut <= 0) return undefined;
  return { username: middle.slice(0, cut), spec: middle.slice(cut + 1), environment };
}
