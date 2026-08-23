'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GradeResult } from '@/course/types';

const MARK = { pass: '✓', fail: '×', blocked: '·' } as const;

export function Checkpoints({
  lab,
  code,
  participant,
  token,
  slot,
}: {
  lab: number;
  code: string;
  participant: string;
  token: string;
  slot: number;
}) {
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const check = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/checkpoints?lab=${lab}&k=${encodeURIComponent(code)}` +
          `&p=${encodeURIComponent(participant)}&t=${encodeURIComponent(token)}&slot=${slot}`,
        { cache: 'no-store' },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as Record<string, string>);
        setError(body.detail ?? body.error ?? `HTTP ${res.status}`);
        return;
      }
      setGrade((await res.json()) as GradeResult);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [lab, code, participant, token, slot]);

  // Poll while the lab is in progress, so an apply turns checks green without
  // anybody touching the page. 15s is the training portal's interval and it is a
  // good one: fast enough to feel live, slow enough not to matter to the account's
  // request budget.
  useEffect(() => {
    void check();
    const id = setInterval(() => void check(), 15_000);
    return () => clearInterval(id);
  }, [check]);

  return (
    <section className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2>Exit check</h2>
          <p className="expect">
            {grade
              ? `${grade.verified}/${grade.verifiable} verified` +
                (grade.attested ? `, ${grade.attested} self-attested` : '') +
                ' · re-checked every 15s'
              : 'Reading the Cloud account…'}
          </p>
        </div>
        <button className="btn" onClick={() => void check()} disabled={loading}>
          {loading ? 'Checking…' : 'Re-check'}
        </button>
      </div>

      {error && <p className="notice">{error}</p>}

      <div>
        {grade?.results.map((r) => (
          <div className={`check ${r.status}`} key={r.id}>
            <div className="check-mark" aria-hidden>
              {MARK[r.status]}
            </div>
            <div className="step-body">
              <strong>
                {r.title}
                {r.selfAttested && <span className="chip" style={{ marginLeft: '0.5rem' }}>self-attested</span>}
              </strong>
              <p className="check-detail">{r.detail}</p>
              {r.gradedBy && <p className="check-detail">Verified by {r.gradedBy}.</p>}
              {r.observed && <p className="check-detail observed">{r.observed}</p>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
