#!/usr/bin/env node
/**
 * Print the links a developer needs, before `next dev` takes over the terminal.
 *
 * A student never types a URL -- their sandbox prints one with all four values in
 * it. Locally there is no sandbox, so this does the same job: it loads the same
 * env cascade Next will load, derives a participant token with the same HMAC the
 * state service uses, and prints ready-to-click links.
 *
 * Run standalone at any time with `pnpm link:lab`.
 */
import { createHmac } from 'node:crypto';
// CommonJS, so it has no named exports from ESM.
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;

// The same loader Next uses, so this cannot disagree with the running app about
// which .env file won.
loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const port = process.env.PORT ?? '3000';
const origin = `http://localhost:${port}`;
const participant = process.env.DEV_PARTICIPANT ?? 'p-dev';
const slot = process.env.DEV_SLOT ?? '7';

const code = process.env.PORTAL_LINK_CODE;
const secret = process.env.PORTAL_SHARED_SECRET;
const instructor = process.env.PORTAL_INSTRUCTOR_TOKEN;

const ESC = String.fromCharCode(27);
const dim = (s) => `${ESC}[2m${s}${ESC}[0m`;
const bold = (s) => `${ESC}[1m${s}${ESC}[0m`;
const teal = (s) => `${ESC}[36m${s}${ESC}[0m`;

console.log();

if (!code || !secret) {
  const missing = [!code && 'PORTAL_LINK_CODE', !secret && 'PORTAL_SHARED_SECRET'].filter(Boolean);
  console.log(`  ${bold('No lab link:')} ${missing.join(' and ')} not set.`);
  console.log(dim('  cp .env.example .env.local, then fill them in.'));
  console.log();
  process.exit(0);
}

const token = createHmac('sha256', secret).update(participant).digest('hex').slice(0, 40);
const query = `k=${encodeURIComponent(code)}&p=${encodeURIComponent(participant)}&t=${token}&slot=${slot}`;

console.log(`  ${bold('Lab links')} ${dim(`- participant ${participant}, slot ${slot}`)}`);
console.log();
console.log(`  ${dim('overview  ')} ${teal(`${origin}/?${query}`)}`);
for (const n of [1, 2, 3, 4, 5]) {
  console.log(`  ${dim(`lab ${n}     `)} ${teal(`${origin}/lab/${n}?${query}`)}`);
}
if (instructor) {
  console.log(`  ${dim('instructor')} ${teal(`${origin}/instructor?t=${encodeURIComponent(instructor)}`)}`);
} else {
  console.log(`  ${dim('instructor  unreachable - PORTAL_INSTRUCTOR_TOKEN is not set')}`);
}
console.log();

if (!process.env.TEMPORAL_CLOUD_API_KEY) {
  console.log(
    dim('  No TEMPORAL_CLOUD_API_KEY: lab material renders, checkpoints report the missing credential.'),
  );
  console.log();
}
