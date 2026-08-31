import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LABS, lab, snippetKey } from '@/course';
import { snippetContext } from '@/course/naming';
import { resolveSpecName } from '@/course/spec-name';
import { verifyParticipant } from '@/lib/auth';
import { labQuery, verifyCode } from '@/lib/link';
import { Snippet } from '@/lib/Snippet';
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

  const code = one('k') ?? '';
  const username = one('u') ?? one('p') ?? '';
  const token = one('t') ?? '';

  // Two gates, two jobs. The code opens the portal and is what an instructor
  // rotates to retire every outstanding link; the token stops a student reading
  // another student's progress by editing a URL. Neither is the workshop's real
  // access control -- Authentik and the Cloud's own RBAC are -- and the page says
  // so rather than implying more than it does.
  if (!verifyCode(code)) {
    return (
      <main className="wrap" style={{ paddingTop: '3rem' }}>
        <p className="notice">
          Wrong or retired workshop code. <Link href="/">Back to the overview</Link>.
        </p>
      </main>
    );
  }
  if (!verifyParticipant(username, token)) {
    return (
      <main className="wrap" style={{ paddingTop: '3rem' }}>
        <p className="notice">
          This page needs the username and view token from your personalised link.{' '}
          <Link href={`/join?k=${encodeURIComponent(code)}`}>Join, or recover your link</Link>.
        </p>
      </main>
    );
  }

  // Read once, for the whole page: the spec name is the student's own choice, so
  // the only place the portal can learn it is the namespace tags the reconciler
  // wrote. Degrades to a `<spec>` placeholder without a Cloud credential.
  const spec = await resolveSpecName(username);
  const ctx = snippetContext(username, spec);
  const steps = def.steps(ctx);
  const snippets = def.snippets?.(ctx) ?? [];

  // Snippets go inside the step that asks for them. Anything no step claims still
  // renders after the list, so a snippet can never end up invisible -- the failure
  // mode a claim-by-key scheme invites.
  const byKey = new Map(snippets.map((sn) => [snippetKey(sn), sn]));
  const claimed = new Set(steps.flatMap((st) => st.snippets ?? []));
  // `hidden` snippets are emitted by snippets:emit but never shown: an answer
  // that must compile is not always an answer worth reading.
  const unclaimed = snippets.filter((sn) => !sn.hidden && !claimed.has(snippetKey(sn)));
  const qs = labQuery(username, token);

  // By POSITION in LABS, not `def.number + 1`. Numbering happens to be contiguous
  // and that is not a thing to depend on: a gap would silently turn every lab
  // before it into "the last one".
  const next = LABS[LABS.findIndex((l) => l.number === def.number) + 1];

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
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <p className="eyebrow">Challenge {def.number}</p>
            <span className="wordmark">
              <span className="wordmark-dot" aria-hidden />
              Temporal Platform Workshop
            </span>
          </div>
          <h1>{def.title}</h1>
          <p style={{ color: 'var(--muted)' }}>{def.outcome}</p>
        </div>
      </header>

      <main className="wrap stack-lg">
        <p>
          <RichText>{def.intro}</RichText>
        </p>

        {def.diagram && (
          <div className="diagram-svg" dangerouslySetInnerHTML={{ __html: def.diagram }} />
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
                  {s.lead && (
                    <p className="expect">
                      <RichText>{s.lead}</RichText>
                    </p>
                  )}
                  {s.command && <CodeBlock>{s.command}</CodeBlock>}
                  {s.expect && (
                    <p className="expect">
                      <RichText>{s.expect}</RichText>
                    </p>
                  )}
                  {s.bullets && s.bullets.length > 0 && (
                    <ul className="expect bullets">
                      {s.bullets.map((b, i) => (
                        <li key={i}>
                          <RichText>{b}</RichText>
                        </li>
                      ))}
                    </ul>
                  )}
                  {s.closing && (
                    <p className="expect">
                      <RichText>{s.closing}</RichText>
                    </p>
                  )}
                  {(s.snippets ?? []).map((key) => {
                    const sn = byKey.get(key);
                    if (!sn) {
                      // Loud rather than silent: a renamed file must not quietly
                      // detach its answer from the step that needs it.
                      throw new Error(
                        `lab ${def.number} step "${s.label}" claims snippet "${key}", which does not exist`,
                      );
                    }
                    return <Snippet key={key} snippet={sn} inStep />;
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

          {unclaimed.length > 0 && (
          <section className="stack">
            <h2>Also worth having</h2>
            {unclaimed.map((sn, i) => (
              <Snippet key={snippetKey(sn) || i} snippet={sn} />
            ))}
          </section>
        )}

      <Checkpoints
        lab={def.number}
        code={code}
        username={username}
        token={token}
      />

      {/* After the checkpoints, because the checkpoints are how you know whether
          you are done. The nav at the top of the page reaches every challenge;
          this is the one a student follows without reading it. */}
      <nav className="lab-next">
        {next ? (
          <>
            <Link className="btn btn-cta" href={`/lab/${next.number}${qs}`}>
              Challenge {next.number}: {next.title} →
            </Link>
            <span className="expect">{next.outcome}</span>
          </>
        ) : (
          <>
            <Link className="btn btn-cta" href={`/${qs}`}>
              Back to the overview →
            </Link>
            <span className="expect">
              That was the last challenge. The overview lists all five, and what each one graded.
            </span>
          </>
        )}
      </nav>
      </main>
    </>
  );
}
