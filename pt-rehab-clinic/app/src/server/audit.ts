import 'server-only';
import { headers } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { requireStaff } from '@/server/session';
import type { AuditAction } from '@/server/audit-types';

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  patientId?: string | null;
  summary?: string;
}

/**
 * Explicit audit entry (spec §6).
 *
 * Writes are logged by database trigger. Reads, prints, exports and sends
 * cannot be — Postgres has no SELECT trigger — so they are logged here, at the
 * action. That is why patient chart reads must go through getPatientChart()
 * below rather than querying the tables directly.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  const staff = await requireStaff();
  const supabase = await supabaseServer();
  const h = await headers();

  const { error } = await supabase.from('audit_log').insert({
    actor_staff_id: staff.id,
    actor_role: staff.role,
    clinic_id: staff.clinic_id,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    patient_id: entry.patientId ?? null,
    summary: entry.summary ?? null,
    ip: h.get('x-forwarded-for') ?? null,
    user_agent: h.get('user-agent') ?? null,
  });

  // An unlogged read is a compliance gap, not a cosmetic failure: fail loudly.
  if (error) throw new Error(`Audit write failed: ${error.message}`);
}

/**
 * The one way to read a patient chart. Every call leaves a `view` entry naming
 * the staff member, the patient and the time.
 *
 * RLS still decides what comes back — this function does not widen access. It
 * exists so that access which RLS permits is also recorded.
 */
export async function getPatientChart(patientId: string) {
  const supabase = await supabaseServer();

  const { data: patient, error } = await supabase
    .from('patients').select('*').eq('id', patientId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!patient) return null; // outside the caller's branch, or does not exist

  const [episodes, encounters, programs, documents, appointments, followups] = await Promise.all([
    supabase.from('episodes').select('*').eq('patient_id', patientId)
      .order('started_on', { ascending: false }),
    supabase.from('encounters').select('*').eq('patient_id', patientId)
      .order('occurred_at', { ascending: false }),
    supabase.from('programs').select('*').eq('patient_id', patientId)
      .order('created_at', { ascending: false }),
    supabase.from('documents').select('*').eq('patient_id', patientId)
      .order('created_at', { ascending: false }),
    supabase.from('appointments').select('*, staff:provider_id(full_name), rooms:room_id(name)')
      .eq('patient_id', patientId).order('starts_at', { ascending: false }),
    supabase.from('v_followup_due').select('*').eq('patient_id', patientId),
  ]);

  await logAudit({
    action: 'view',
    entityType: 'patients',
    entityId: patientId,
    patientId,
    summary: `Viewed chart for ${patient.last_name}, ${patient.first_name}`,
  });

  return {
    patient,
    episodes: episodes.data ?? [],
    encounters: encounters.data ?? [],
    programs: programs.data ?? [],
    documents: documents.data ?? [],
    appointments: appointments.data ?? [],
    followups: followups.data ?? [],
  };
}

/** SOAP bodies, which front desk cannot read (RLS returns nothing for them). */
export async function getEncounterNote(encounterId: string) {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from('encounter_notes').select('*').eq('encounter_id', encounterId).maybeSingle();
  return data;
}
