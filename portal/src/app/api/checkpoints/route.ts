import { NextResponse } from 'next/server';
import { LAB_NUMBERS } from '@/course';
import { gradeLab } from '@/course/grading';
import { verifyParticipant } from '@/lib/auth';
import { verifyCode } from '@/lib/link';

export const dynamic = 'force-dynamic';

/**
 * Grading is a lab aid, not a security boundary -- but it reads the shared
 * training account, so it stays behind the same per-student token as the pages,
 * and a student may only grade themselves.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const username = url.searchParams.get('u') ?? url.searchParams.get('p');
  const token = url.searchParams.get('t');
  const labNumber = Number(url.searchParams.get('lab') ?? '1');

  // The code is checked here as well as on the page. Without it, rotating
  // PORTAL_LINK_CODE would retire the pages while leaving this endpoint open to
  // any link that had been saved -- which would make the kill switch decorative.
  if (!verifyCode(url.searchParams.get('k'))) {
    return NextResponse.json({ error: 'link-retired' }, { status: 401 });
  }
  if (!verifyParticipant(username, token)) {
    return NextResponse.json({ error: 'bad-token' }, { status: 401 });
  }
  if (!LAB_NUMBERS.includes(labNumber)) {
    return NextResponse.json({ error: 'unknown-lab' }, { status: 404 });
  }

  try {
    return NextResponse.json(await gradeLab(labNumber, username as string));
  } catch (err) {
    // Surface the reason. A checkpoint panel that just says "failed" sends a
    // student to the instructor; one that says the credential expired does not.
    return NextResponse.json(
      { error: 'grading-failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
