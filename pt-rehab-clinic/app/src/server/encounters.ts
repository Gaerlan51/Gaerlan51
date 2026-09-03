'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { requireRole } from '@/server/session';
import { describeWriteError, assertAffected } from '@/domain/conflicts';

const SoapInput = z.object({
  soap_subjective: z.string().optional().nullable(),
  soap_objective: z.string().optional().nullable(),
  soap_assessment: z.string().optional().nullable(),
  soap_plan: z.string().optional().nullable(),
});

/**
 * A consultation or therapy session. Created as a draft; SOAP text lives in
 * encounter_notes, which front desk cannot read (spec §3).
 */
export async function createEncounter(input: {
  patient_id: string;
  episode_id?: string | null;
  kind: 'md_consult' | 'therapy_session' | 'acupuncture';
  occurred_at?: string;
  addendum_of?: string | null;
}) {
  const staff = await requireRole('owner', 'therapist');
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('encounters')
    .insert({
      ...input,
      clinic_id: staff.clinic_id,
      provider_id: staff.id,
      occurred_at: input.occurred_at ?? new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) throw new Error(describeWriteError(error) ?? error.message);

  await supabase.from('encounter_notes')
    .insert({ encounter_id: data.id, clinic_id: staff.clinic_id });

  revalidatePath(`/patients/${input.patient_id}`);
  return data.id as string;
}

export async function saveSoap(encounterId: string, form: FormData) {
  await requireRole('owner', 'therapist');
  const parsed = SoapInput.parse(Object.fromEntries(form));
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('encounter_notes').update(parsed).eq('encounter_id', encounterId).select('encounter_id');

  // The database refuses once the encounter is final (spec §7).
  if (error) throw new Error(describeWriteError(error) ?? error.message);
  assertAffected(data?.length, 'The note');
}

/**
 * Finalizing locks the four SOAP fields. Corrections are filed as an addendum
 * encounter referencing the original — never an in-place edit. That is what
 * makes the record defensible.
 */
export async function finalizeEncounter(encounterId: string, patientId: string) {
  await requireRole('owner', 'therapist');
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('encounters').update({ status: 'final' }).eq('id', encounterId).select('id');

  if (error) throw new Error(describeWriteError(error) ?? error.message);
  assertAffected(data?.length, 'The encounter');
  revalidatePath(`/patients/${patientId}`);
}

export async function createAddendum(originalEncounterId: string, patientId: string, episodeId: string | null) {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from('encounters').select('kind').eq('id', originalEncounterId).single();

  return createEncounter({
    patient_id: patientId,
    episode_id: episodeId,
    kind: (data?.kind ?? 'md_consult') as 'md_consult',
    addendum_of: originalEncounterId,
  });
}
