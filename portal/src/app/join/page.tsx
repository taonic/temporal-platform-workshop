import Link from 'next/link';
import { config } from '@/config';
import { verifyCode } from '@/lib/link';
import { JoinForm } from './JoinForm';

export const dynamic = 'force-dynamic';

/**
 * The bare join link, which is what the sandbox prints.
 *
 * It cannot print a personalised one: the student has not chosen a username yet.
 * They choose here, the portal issues the personalised link back, and that URL is
 * what they bookmark and return through.
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const code = typeof query.k === 'string' ? query.k : '';

  if (!verifyCode(code)) {
    return (
      <main className="wrap" style={{ paddingTop: '3rem' }}>
        <p className="notice">
          Wrong or retired workshop code. <Link href="/">Back to the overview</Link>.
        </p>
      </main>
    );
  }

  return (
    <>
      <header className="top">
        <div className="wrap stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <p className="eyebrow">Join</p>
            <span className="wordmark">
              <span className="wordmark-dot" aria-hidden />
              Temporal Platform Workshop
            </span>
          </div>
          <h1>Build a control plane for Temporal Cloud</h1>
          <p style={{ color: 'var(--muted)' }}>
            Five challenges. You will provision namespaces from a spec, invert it into a control
            loop, and finish by using the platform you built as one of its customers.
          </p>
        </div>
      </header>
      <main className="wrap stack-lg">
        {/* Server config, read here and handed down rather than exposed to the
            client as env vars. */}
        <JoinForm
          code={code}
          domain={config().WORKSHOP_DOMAIN}
          loginUrl={config().PORTAL_CLOUD_LOGIN_URL}
        />
      </main>
    </>
  );
}
