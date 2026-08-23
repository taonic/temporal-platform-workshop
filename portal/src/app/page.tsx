import Link from 'next/link';
import { LABS } from '@/course';
import { config } from '@/config';
import { verifyCode } from '@/lib/link';

export const dynamic = 'force-dynamic';

/**
 * Landing page. In a cohort nobody types anything here -- the sandbox prints a
 * link with the participant, token and slot already in it. This page exists for
 * the case where somebody lost the link, and to say what the portal can and
 * cannot see.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const code = one('k') ?? '';
  // The code opens the portal; the participant token binds the identity. A link
  // from the sandbox carries both, so neither costs a student anything.
  const opened = verifyCode(code);
  const participant = one('p') ?? '';
  const token = one('t') ?? '';
  const slot = one('slot') ?? '';
  const known = opened && Boolean(participant && token && slot);

  const sandbox = (() => {
    try {
      return config().PORTAL_SANDBOX_URL;
    } catch {
      return undefined;
    }
  })();

  const qs = known
    ? `?k=${encodeURIComponent(code)}&p=${encodeURIComponent(participant)}` +
      `&t=${encodeURIComponent(token)}&slot=${encodeURIComponent(slot)}`
    : '';

  return (
    <>
      <header className="top">
        <div className="wrap">
          <p className="eyebrow">Temporal platform workshop</p>
          <h1>Build a control plane</h1>
          <p style={{ color: 'var(--muted)', maxWidth: '38rem' }}>
            Most Temporal training teaches you to write a Workflow. This teaches you to build the
            platform underneath it: a CLI that asks four questions, a reconciler that turns the
            answers into real namespaces and credentials, and a paved road where a decorator is the
            only thing a developer writes.
          </p>
        </div>
      </header>

      <main className="wrap stack-lg">
        {!opened && (
          <div className="notice">
            This portal needs the workshop code — the one on screen, or in the link your sandbox
            printed: <code>/?k=CODE</code>. The code changes between cohorts, so an old link stops
            working.
            {sandbox && (
              <>
                {' '}
                <a href={sandbox}>Open the sandbox</a>.
              </>
            )}
          </div>
        )}

        {opened && !known && (
          <div className="notice">
            The code is right, but this link is missing your participant id, view token and leased
            slot. Your sandbox printed a link with all four — check its setup output, or run{' '}
            <code>echo $PORTAL_LINK</code> in the sandbox terminal.
          </div>
        )}

        <section className="stack">
          <h2>The five challenges</h2>
          <div className="steps">
            {LABS.map((l) => (
              <div className="step" key={l.number}>
                <div className="step-n">{l.number}</div>
                <div className="step-body">
                  <h3>
                    {known ? (
                      <Link href={`/lab/${l.number}${qs}`}>{l.title}</Link>
                    ) : (
                      l.title
                    )}
                  </h3>
                  <p className="expect">{l.outcome}</p>
                  {l.writes && (
                    <p className="expect">
                      You write <code>{l.writes}</code>
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card stack">
          <h2>What this page can and cannot see</h2>
          <p className="expect">
            Your control plane runs on a Temporal dev server <em>inside your own sandbox</em>, and
            nothing out here can reach it. What every student does share is the Temporal Cloud
            account — so that is what this portal reads: your namespaces, their tags, and the
            identities the platform created.
          </p>
          <p className="expect">
            Your reconciler writes progress into namespace tags for exactly this reason. It is also
            why a few checkpoints are marked <strong>self-attested</strong>: a pod on k3s and a
            secret in Vault exist only in your sandbox. Those are graded by the Instruqt check for
            that challenge, which runs inside it. A grader that implied it had verified them would
            be worse than one that admits it did not.
          </p>
        </section>
      </main>
    </>
  );
}
