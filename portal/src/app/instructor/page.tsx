import { Cohort } from './Cohort';
import { verifyInstructor } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * The instructor view.
 *
 * The training portal's README calls its equivalent "the fastest way to see who is
 * stuck -- a student with no namespace after ten minutes is visible without
 * asking." That matters more in a self-paced cohort, not less, because nobody can
 * walk the room.
 *
 * Gated on its own long-lived token: this page lists every participant, and the
 * student link gets pasted into chat.
 */
export default async function Instructor({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params['t'];
  const token = Array.isArray(raw) ? raw[0] : raw;

  if (!verifyInstructor(token)) {
    return (
      <main className="wrap" style={{ paddingTop: '3rem' }}>
        <p className="notice">
          This view needs the instructor token: <code>/instructor?t=$PORTAL_INSTRUCTOR_TOKEN</code>.
        </p>
      </main>
    );
  }

  return (
    <>
      <header className="top">
        <div className="wrap wide stack">
          <p className="eyebrow">Instructor</p>
          <h1>Cohort</h1>
          <p style={{ color: 'var(--muted)', maxWidth: '40rem' }}>
            Read from the Cloud account, grouped by leased slot. Progress is inferred from what
            reached the Cloud — namespaces, their environments and their tags — because nothing out
            here can see inside a sandbox.
          </p>
        </div>
      </header>
      <main className="wrap wide stack-lg">
        <Cohort token={token as string} />
        <section className="card stack">
          <h2>Reading this table</h2>
          <p className="expect">
            A slot with one environment and no drift tag has finished challenge 1 and stopped. A slot
            in use for twenty minutes with nothing in the Specs column is somebody stuck on
            Terraform. An <strong>untagged</strong> participant means the namespace was made before
            the reconciler wrote participant tags — or by hand.
          </p>
        </section>
      </main>
    </>
  );
}
