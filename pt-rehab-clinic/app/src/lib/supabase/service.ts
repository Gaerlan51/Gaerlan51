import { createClient } from '@supabase/supabase-js';

/**
 * SERVICE ROLE — BYPASSES ROW LEVEL SECURITY ENTIRELY.
 *
 * Spec §5: permitted only in the scheduled reminder job and in migrations.
 * Never in a route handler or Server Action running on behalf of a signed-in
 * user — one such import silently disables every protection in 0004_rls.sql
 * for that code path, with no error and no failing test to notice it.
 *
 * `npm run guard:service-role` fails the build if this module is imported
 * outside src/server/jobs/ and scripts/. The `reason` argument is required so
 * that every bypass is self-documenting at the call site.
 */
export function createServiceRoleClient(reason: string) {
  if (!reason || reason.length < 10) {
    throw new Error('createServiceRoleClient requires a written reason for the RLS bypass.');
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-rls-bypass-reason': reason } },
  });
}
