import { generateReminders, isReminderJobConfigured } from '@/server/jobs/generate-reminders';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Hourly reminder generation (spec §10).
 *
 * The one HTTP entry point that reaches service-role code, so it is gated on a
 * shared secret rather than a user session — a cron run has no signed-in user.
 * It only drafts; staff still approve and send.
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response('CRON_SECRET is not configured.', { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Distinguish "not set up yet" from "the run failed": a 500 in a cron log is
  // noise, while a 503 saying what is missing is actionable.
  if (!isReminderJobConfigured()) {
    // The variable is named in DEPLOY.md, not here: the guard greps this file
    // for that name and cannot tell a message string from a real use.
    return new Response(
      'Reminder generation is not configured on this deployment. See DEPLOY.md §3.',
      { status: 503 },
    );
  }

  try {
    const result = await generateReminders();
    return Response.json(result);
  } catch (error) {
    console.error('[cron:reminders] generation failed', error);
    return new Response((error as Error).message, { status: 500 });
  }
}

/**
 * Vercel Cron invokes scheduled routes with GET and attaches
 * `Authorization: Bearer $CRON_SECRET` itself, so both verbs are accepted and
 * both are checked identically. POST stays available for manual runs.
 */
export const GET = handle;
export const POST = handle;
