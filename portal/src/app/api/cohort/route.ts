import { NextResponse } from 'next/server';
import { readCohort } from '@/course/grading';
import { config } from '@/config';
import { verifyInstructor } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!verifyInstructor(url.searchParams.get('t'))) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }
  try {
    const rows = await readCohort();
    return NextResponse.json({ rows, cohortSize: config().PORTAL_COHORT_SIZE });
  } catch (err) {
    return NextResponse.json(
      { error: 'cohort-read-failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
