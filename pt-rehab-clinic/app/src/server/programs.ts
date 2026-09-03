'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { requireRole, requireStaff } from '@/server/session';
import { describeWriteError, assertAffected } from '@/domain/conflicts';
import { logAudit } from '@/server/audit';
import type { Discipline } from '@/lib/types';

export interface ProgramItem {
  exercise: string;
  sets?: string;
  reps?: string;
  frequency?: string;
  notes?: string;
}

/**
 * The template library ships empty (spec §15). Clinical content is the
 * doctor's to supply; inventing exercise protocols is not the builder's call.
 */
export async function listTemplates(discipline?: Discipline) {
  await requireStaff();
  const supabase = await supabaseServer();
  let query = supabase.from('program_templates')
    .select('id, name, discipline, body, clinic_id').eq('is_active', true).order('name');
  if (discipline) query = query.eq('discipline', discipline);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Build a patient's program, optionally seeded from a template, then edit it. */
export async function createProgram(input: {
  patient_id: string;
  episode_id?: string | null;
  discipline: Discipline;
  title: string;
  template_id?: string | null;
  items?: ProgramItem[];
}) {
  const staff = await requireRole('owner', 'therapist');
  const supabase = await supabaseServer();

  let items = input.items ?? [];
  if (input.template_id && items.length === 0) {
    const { data: template } = await supabase
      .from('program_templates').select('body').eq('id', input.template_id).maybeSingle();
    items = ((template?.body as { items?: ProgramItem[] } | null)?.items ?? []);
  }

  const { data, error } = await supabase
    .from('programs')
    .insert({
      clinic_id: staff.clinic_id,
      patient_id: input.patient_id,
      episode_id: input.episode_id ?? null,
      template_id: input.template_id ?? null,
      discipline: input.discipline,
      title: input.title,
    })
    .select('id')
    .single();

  if (error) throw new Error(describeWriteError(error) ?? error.message);

  await supabase.from('program_body')
    .insert({ program_id: data.id, clinic_id: staff.clinic_id, body: { items } });

  revalidatePath(`/patients/${input.patient_id}`);
  return data.id as string;
}

export async function updateProgramItems(programId: string, items: ProgramItem[]) {
  await requireRole('owner', 'therapist');
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from('program_body').update({ body: { items } }).eq('program_id', programId)
    .select('program_id');
  if (error) throw new Error(describeWriteError(error) ?? error.message);
  assertAffected(data?.length, 'The program');
}

export async function signProgram(programId: string, patientId: string) {
  await requireRole('owner');
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from('programs').update({ status: 'signed' }).eq('id', programId).select('id');
  if (error) throw new Error(describeWriteError(error) ?? error.message);
  assertAffected(data?.length, 'The signature');
  revalidatePath(`/patients/${patientId}`);
}

export async function getProgramForPrint(programId: string) {
  await requireStaff();
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('programs')
    .select(`*, program_body(body), patients:patient_id(first_name, last_name, birth_date),
             clinics:clinic_id(name, address, phone), signer:signed_by(full_name, prc_license_no)`)
    .eq('id', programId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  await logAudit({
    action: 'print',
    entityType: 'programs',
    entityId: programId,
    patientId: data.patient_id,
    summary: `Printed ${data.discipline} program (${data.status})`,
  });
  return data;
}
