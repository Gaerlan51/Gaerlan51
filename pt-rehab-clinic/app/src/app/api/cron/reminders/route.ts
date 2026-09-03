import { generateReminders } from '@/server/jobs/generate-reminders';

export const dynamic = 'force-dynamic';

/**
 * Hourly reminder generation (spec §10).
 *
 * This is the one HTTP entry point that reaches service-role code, so it is
 * gated on a shared secret rather than a user session — there is no signed-in
 * user on a cron run. It only drafts; staff still approve and send.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const result = await generateReminders();
  return Response.json(result);
}
