import { NextResponse } from 'next/server';
import { LAB_NUMBERS } from '@/course';
import { gradeLab } from '@/course/grading';
import { verifyParticipant } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Grading is a lab aid, not a security boundary -- but it reads the shared
 * training account, so it stays behind the same per-participant token as the
 * pages, and a participant may only grade themselves.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const participant = url.searchParams.get('p');
  const token = url.searchParams.get('t');
  const slot = Number(url.searchParams.get('slot') ?? '0');
  const labNumber = Number(url.searchParams.get('lab') ?? '1');

  if (!verifyParticipant(participant, token)) {
    return NextResponse.json({ error: 'bad-token' }, { status: 401 });
  }
  if (!Number.isInteger(slot) || slot <= 0) {
    return NextResponse.json({ error: 'bad-slot' }, { status: 400 });
  }
  if (!LAB_NUMBERS.includes(labNumber)) {
    return NextResponse.json({ error: 'unknown-lab' }, { status: 404 });
  }

  try {
    return NextResponse.json(await gradeLab(labNumber, participant as string, slot));
  } catch (err) {
    // Surface the reason. A checkpoint panel that just says "failed" sends a
    // student to the instructor; one that says the credential expired does not.
    return NextResponse.json(
      { error: 'grading-failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
