import { config } from '@/config';
import type { SnippetContext } from './types';

/**
 * Per-student names, derived from the leased slot.
 *
 * The slot -- not the participant id -- is what the physical namespace name is
 * built from, because Temporal Cloud reserves a namespace name after deletion. A
 * name derived from a participant would be burned the first time their namespace
 * was deleted; slot 7 is reused by design.
 *
 * The spec name is the student's own choice, so these are patterns rather than
 * literals. That is a deliberate difference from the training portal, where the
 * portal chose the name: here the platform decides the slot and the team decides
 * the name, which is the boundary the whole workshop is about.
 */
export function snippetContext(participant: string, slot: number): SnippetContext {
  const cfg = config();
  return {
    participant,
    slot,
    accountId: cfg.PORTAL_ACCOUNT_ID,
    namespacePattern: `ws-${slot}-<spec>-<environment>`,
    stagingSuffix: `ws-${slot}-<spec>-staging`,
    prodSuffix: `ws-${slot}-<spec>-prod`,
    sandboxUrl: cfg.PORTAL_SANDBOX_URL,
  };
}

/** Matches ws-<slot>-<spec>-<env>, which is the only name shape the platform makes. */
const NAME = /^ws-(\d+)-([a-z][a-z0-9-]*)-(staging|prod)$/;

export interface ParsedName {
  slot: number;
  spec: string;
  environment: 'staging' | 'prod';
}

export function parsePhysicalName(name: string): ParsedName | undefined {
  const m = NAME.exec(name);
  if (!m) return undefined;
  return {
    slot: Number(m[1]),
    spec: m[2] as string,
    environment: m[3] as 'staging' | 'prod',
  };
}
