import { NextResponse } from 'next/server';
import { listNamespaces } from '@/platform/cloud';

export const dynamic = 'force-dynamic';

/**
 * Liveness plus one authenticated read.
 *
 * The read is the point. The training portal ran a canary workflow for exactly
 * this reason: you want to learn that the portal's Cloud credential is broken at
 * 09:00, not at 15:30 when a student's checkpoints all go red at once.
 */
export async function GET() {
  try {
    const namespaces = await listNamespaces();
    return NextResponse.json({ ok: true, namespacesVisible: namespaces.length });
  } catch (err) {
    return NextResponse.json(
      { ok: false, detail: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
