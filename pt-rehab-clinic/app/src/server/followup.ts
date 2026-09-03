'use server';
import { supabaseServer } from '@/lib/supabase/server';
import { requireStaff } from '@/server/session';
import { sortByUrgency } from '@/domain/followup';
import type { FollowupRow } from '@/lib/types';

/**
 * The "due for MD follow-up" worklist (spec §8). Reads v_followup_due — the
 * one definition of the rule — and is branch-scoped by that view's RLS.
 */
export async function listFollowupsDue(onlyDue = true) {
  await requireStaff();
  const supabase = await supabaseServer();

  let query = supabase
    .from('v_followup_due')
    .select('*, patients:patient_id(first_name, last_name, phone), clinics:clinic_id(name)');
  if (onlyDue) query = query.eq('is_due', true);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return sortByUrgency((data ?? []) as unknown as FollowupRow[]) as (FollowupRow & {
    patients: { first_name: string; last_name: string; phone: string | null } | null;
    clinics: { name: string } | null;
  })[];
}

export async function followupForEpisode(episodeId: string): Promise<FollowupRow | null> {
  await requireStaff();
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from('v_followup_due').select('*').eq('episode_id', episodeId).maybeSingle();
  return (data as FollowupRow) ?? null;
}
