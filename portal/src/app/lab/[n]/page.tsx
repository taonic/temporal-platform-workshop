import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LABS, lab } from '@/course';
import { snippetContext } from '@/course/naming';
import { verifyParticipant } from '@/lib/auth';
import { CodeBlock, RichText } from '@/lib/ui';
import { Checkpoints } from './Checkpoints';

export const dynamic = 'force-dynamic';

export default async function LabPage({
  params,
  searchParams,
}: {
  params: Promise<{ n: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { n } = await params;
  const query = await searchParams;
  const one = (k: string) => {
    const v = query[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const def = lab(Number(n));
  if (!def) notFound();

  const participant = one('p') ?? '';
  const token = one('t') ?? '';
  const slot = Number(one('slot') ?? '0');

  // The token stops a student reading another student's progress by editing a
  // URL. It is not the workshop's access control -- Okta and the Cloud's own RBAC
  // are -- and the page says so rather than implying more than it does.
  if (!verifyParticipant(participant, token) || !slot) {
    return (
      <main className="wrap" style={{ paddingTop: '3rem' }}>
        <p className="notice">
          This page needs the participant id, view token and slot from the link your sandbox
          printed. <Link href="/">Back to the overview</Link>.
        </p>
      </main>
    );
  }

  const ctx = snippetContext(participant, slot);
  const steps = def.steps(ctx);
  const qs = `?p=${encodeURIComponent(participant)}&t=${encodeURIComponent(token)}&slot=${slot}`;

  return (
    <>
      <header className="top">
        <div className="wrap stack">
          <nav className="labs">
            <Link href={`/${qs}`}>Overview</Link>
            {LABS.map((l) => (
              <Link
                key={l.number}
                href={`/lab/${l.number}${qs}`}
                aria-current={l.number === def.number ? 'page' : undefined}
              >
                {l.number}. {l.title}
              </Link>
            ))}
          </nav>
          <p className="eyebrow">Challenge {def.number}</p>
          <h1>{def.title}</h1>
          <p style={{ color: 'var(--muted)' }}>{def.outcome}</p>
          <div className="row">
            <span className="chip">slot {ctx.slot}</span>
            <span className="chip">{ctx.namespacePattern}</span>
            <span className="chip">~{def.minutes} min</span>
            {def.writes && <span className="chip">you write {def.writes}</span>}
          </div>
        </div>
      </header>

      <main className="wrap stack-lg">
        <p>
          <RichText>{def.intro}</RichText>
        </p>

        {def.feedback && (
          <section className="card stack">
            <h2>Your feedback loop</h2>
            <p className="expect">
              Run this before any grader does. It fails on a fresh clone, on purpose — the tests are
              the lab.
            </p>
            <CodeBlock>{def.feedback}</CodeBlock>
          </section>
        )}

        <section className="stack">
          <h2>Steps</h2>
          <div className="steps">
            {steps.map((s, i) => (
              <div className="step" key={i}>
                <div className="step-n">{i + 1}</div>
                <div className="step-body">
                  <h3>
                    <RichText>{s.label}</RichText>
                  </h3>
                  {s.grades && (
                    <div>
                      <span className="badge">graded: {s.grades}</span>
                    </div>
                  )}
                  {s.command && <CodeBlock>{s.command}</CodeBlock>}
                  {s.expect && (
                    <p className="expect">
                      <RichText>{s.expect}</RichText>
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <Checkpoints lab={def.number} participant={participant} token={token} slot={slot} />
      </main>
    </>
  );
}
