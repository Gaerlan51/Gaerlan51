'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { requireRole, requireStaff } from '@/server/session';
import { describeWriteError, assertAffected } from '@/domain/conflicts';

const BookingInput = z.object({
  patient_id: z.string().uuid(),
  episode_id: z.string().uuid().optional().nullable(),
  provider_id: z.string().uuid(),
  room_id: z.string().uuid().optional().nullable(),
  starts_at: z.string(),
  ends_at: z.string(),
  kind: z.enum(['md_consult', 'therapy_session', 'acupuncture']),
});

/**
 * Booking (spec §4).
 *
 * There is deliberately no application-level "is this slot free?" check before
 * the insert. Two front-desk staff booking the same slot would both pass such
 * a check and both write; the exclusion constraints in 0001_schema.sql cannot
 * be raced. We insert, and translate the refusal into readable text.
 */
export async function bookAppointment(input: z.input<typeof BookingInput>) {
  const staff = await requireRole('owner', 'admin');
  const parsed = BookingInput.parse(input);
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('appointments')
    .insert({ ...parsed, clinic_id: staff.clinic_id })
    .select('id')
    .single();

  if (error) {
    const message = describeWriteError(error);
    throw new Error(message ?? 'The appointment could not be booked.');
  }

  revalidatePath('/schedule');
  revalidatePath(`/patients/${parsed.patient_id}`);
  return data.id as string;
}

export async function setAppointmentStatus(
  appointmentId: string,
  status: 'booked' | 'completed' | 'cancelled' | 'no_show',
) {
  await requireStaff();
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('appointments').update({ status }).eq('id', appointmentId)
    .select('id, patient_id, episode_id, provider_id, kind, starts_at');

  if (error) throw new Error(describeWriteError(error) ?? error.message);
  assertAffected(data?.length, 'The appointment');
  revalidatePath('/schedule');
  return data![0];
}

/**
 * Completing a session is what advances the follow-up counter: it writes the
 * therapy_session encounter that v_followup_due counts (spec §8).
 */
export async function completeSession(appointmentId: string) {
  const staff = await requireStaff();
  const supabase = await supabaseServer();

  const { data: appt, error: readError } = await supabase
    .from('appointments')
    .select('id, patient_id, episode_id, provider_id, kind, starts_at, encounter_id, clinic_id')
    .eq('id', appointmentId)
    .maybeSingle();

  if (readError) throw new Error(readError.message);
  if (!appt) throw new Error('That appointment is not visible to you.');
  if (appt.encounter_id) return appt.encounter_id as string;

  const { data: encounter, error } = await supabase
    .from('encounters')
    .insert({
      clinic_id: appt.clinic_id,
      patient_id: appt.patient_id,
      episode_id: appt.episode_id,
      kind: appt.kind,
      provider_id: appt.provider_id,
      occurred_at: appt.starts_at,
      status: 'final',
    })
    .select('id')
    .single();

  if (error) throw new Error(describeWriteError(error) ?? error.message);

  await supabase.from('appointments')
    .update({ status: 'completed', encounter_id: encounter.id }).eq('id', appointmentId);

  revalidatePath('/schedule');
  revalidatePath(`/patients/${appt.patient_id}`);
  void staff;
  return encounter.id as string;
}

export async function listSchedule(fromIso: string, toIso: string) {
  await requireStaff();
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('appointments')
    .select(`id, starts_at, ends_at, kind, status, patient_id, provider_id, room_id, clinic_id,
             patients:patient_id(first_name, last_name),
             staff:provider_id(full_name, discipline),
             rooms:room_id(name)`)
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso)
    .order('starts_at');

  if (error) throw new Error(error.message);
  return data ?? [];
}
