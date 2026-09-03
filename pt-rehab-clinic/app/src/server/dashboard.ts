'use server';
import { supabaseServer } from '@/lib/supabase/server';
import { requireStaff } from '@/server/session';
import type { DashboardRow } from '@/lib/types';
import { periodRange, type Period } from '@/domain/period';

/**
 * The Owner Dashboard (spec §11). Read-only by construction: it calls a
 * stable SQL function and RLS decides the scope — branch staff see their
 * branch, the owner sees all five. There is no write path here at all.
 */
export async function dashboardStats(period: Period = 'month', now = new Date()) {
  await requireStaff();
  const supabase = await supabaseServer();
  const { from, to } = periodRange(period, now);

  const { data, error } = await supabase.rpc('dashboard_stats', {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as DashboardRow[];

  const combined = rows.reduce<DashboardRow>((acc, row) => ({
    ...acc,
    consultations: acc.consultations + row.consultations,
    therapy_sessions: acc.therapy_sessions + row.therapy_sessions,
    active_patients: acc.active_patients + row.active_patients,
    new_patients: acc.new_patients + row.new_patients,
    followups_due: acc.followups_due + row.followups_due,
    no_shows: acc.no_shows + row.no_shows,
    appointments: acc.appointments + row.appointments,
  }), {
    clinic_id: 'combined', clinic_name: 'All branches', consultations: 0, therapy_sessions: 0,
    active_patients: 0, new_patients: 0, followups_due: 0, no_shows: 0, appointments: 0,
  });

  return { rows, combined, from, to };
}
