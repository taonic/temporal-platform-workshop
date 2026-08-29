'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CohortRow } from '@/course/grading';

interface Payload {
  rows: CohortRow[];
  cohortSize: number;
}

export function Cohort({ token }: { token: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/cohort?t=${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as Record<string, string>);
        setError(body.detail ?? body.error ?? `HTTP ${res.status}`);
        return;
      }
      setData((await res.json()) as Payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [token]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 20_000);
    return () => clearInterval(id);
  }, [load]);

  if (error) return <p className="notice">{error}</p>;
  if (!data) return <p className="expect">Reading the account…</p>;

  const started = data.rows.length;
  const bothEnvs = data.rows.filter((r) => r.environments.length >= 2).length;
  const drifted = data.rows.filter((r) => r.driftCorrected).length;

  return (
    <div className="stack">
      <div className="row">
        <span className="chip">
          {started}/{data.cohortSize} slots in use
        </span>
        <span className="chip">{bothEnvs} past challenge 2</span>
        <span className="chip">{drifted} past challenge 3</span>
        <span className="chip">refreshes every 20s</span>
      </div>

      {started === 0 && (
        <p className="expect">
          No workshop namespaces in the account yet. Nobody has finished challenge 1.
        </p>
      )}

      {started > 0 && (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Cohort</th>
                <th>Namespaces</th>
                <th>Specs</th>
                <th>Environments</th>
                <th>Drift corrected</th>
                <th>Furthest challenge</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                // Inferred, not reported: the portal cannot see inside a sandbox, so
                // progress is read from what reached the Cloud.
                const furthest = r.driftCorrected
                  ? r.specs.length >= 2
                    ? '5 (second spec)'
                    : '3'
                  : r.environments.length >= 2
                    ? '2'
                    : '1';
                return (
                  <tr key={r.username}>
                    <td>{r.username}</td>
                    <td>{r.cohort ?? <span style={{ color: 'var(--muted)' }}>untagged</span>}</td>
                    <td className="num">{r.namespaces}</td>
                    <td>{r.specs.join(', ')}</td>
                    <td>{r.environments.join(', ')}</td>
                    <td>{r.driftCorrected ? 'yes' : '—'}</td>
                    <td className="num">{furthest}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
