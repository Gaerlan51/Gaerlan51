import { createServiceRoleClient } from '@/lib/supabase/service';
import { planReminders } from '@/domain/reminder-plan';
import { appointmentWindow } from '@/domain/reminders';

/**
 * The hourly reminder generator (spec §10).
 *
 * This is one of only two places permitted to use the service-role key: it
 * runs on a schedule with no signed-in user, and must see all five branches.
 * It only ever writes drafts — approval and sending stay with staff.
 */
/**
 * Whether the scheduled job has what it needs to run.
 *
 * Lives here rather than in the route because src/server/jobs/ is the only
 * place permitted to name the service-role key at all (spec §5) — the guard in
 * scripts/guard-service-role.mjs fails the build otherwise, and the right
 * answer to that is to move the code, not to widen the rule.
 */
export function isReminderJobConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export async function generateReminders(now = new Date()) {
  const supabase = createServiceRoleClient('scheduled reminder generation across all branches');
  const window = appointmentWindow(now);

  const [clinics, patients, appointments, followups] = await Promise.all([
    supabase.from('clinics').select('id, name, phone').eq('is_active', true),
    supabase.from('patients').select('id, clinic_id, first_name, phone, email, birth_date'),
    supabase.from('appointments')
      .select('id, clinic_id, patient_id, starts_at, staff:provider_id(full_name)')
      .eq('status', 'booked')
      .gte('starts_at', window.from.toISOString())
      .lt('starts_at', window.to.toISOString()),
    supabase.from('v_followup_due').select('episode_id, clinic_id, patient_id, is_due').eq('is_due', true),
  ]);

  const clinicNames: Record<string, string> = {};
  const clinicPhones: Record<string, string | null> = {};
  for (const c of clinics.data ?? []) {
    clinicNames[c.id] = c.name;
    clinicPhones[c.id] = c.phone;
  }

  const planned = planReminders({
    now,
    clinicNames,
    clinicPhones,
    patients: patients.data ?? [],
    appointments: (appointments.data ?? []).map((a) => ({
      id: a.id,
      clinic_id: a.clinic_id,
      patient_id: a.patient_id,
      starts_at: a.starts_at,
      provider_name: (a.staff as unknown as { full_name?: string } | null)?.full_name ?? null,
    })),
    followups: followups.data ?? [],
  });

  if (planned.length === 0) return { drafted: 0 };

  // dedupe_key is unique, so re-running within the same day is a no-op rather
  // than a second copy of every reminder.
  const { data, error } = await supabase
    .from('reminders')
    .upsert(planned, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    .select('id');

  if (error) throw new Error(`Reminder generation failed: ${error.message}`);
  return { drafted: data?.length ?? 0 };
}
