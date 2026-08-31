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
  // The code opens the portal; the token binds the identity. The sandbox prints
  // only the code -- a student has not chosen a username yet -- so arriving here
  // without an identity is the NORMAL first visit, and /join is where it leads.
  const opened = verifyCode(code);
  const username = one('u') ?? one('p') ?? '';
  const token = one('t') ?? '';
  const known = opened && Boolean(username && token);

  const sandbox = (() => {
    try {
      return config().PORTAL_SANDBOX_URL;
    } catch {
      return undefined;
    }
  })();

  const qs = known
    ? `?k=${encodeURIComponent(code)}&u=${encodeURIComponent(username)}` +
      `&t=${encodeURIComponent(token)}`
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
          <section className="card stack">
            <h2>Start here</h2>
            <p className="expect">
              Pick a username and the workshop is yours. Everything the platform builds is named
              after it — your namespaces, your Vault paths, your state files — so choose something
              you will recognise on a list.
            </p>
            <p>
              <a href={`/join?k=${encodeURIComponent(code)}`}>Join the workshop →</a>
            </p>
            <p className="expect">
              Been here before? Go to the same page and type the same username: that returns your
              account and a fresh password, rather than refusing it.
            </p>
          </section>
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
            secret in Vault exist only in your sandbox. Those are graded by the check scripts in{' '}
            <code>instruqt/checks/</code>, which run inside it. A grader that implied it had
            verified them would be worse than one that admits it did not.
          </p>
        </section>
      </main>
    </>
  );
}
