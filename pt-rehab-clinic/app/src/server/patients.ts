'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { requireRole, requireStaff } from '@/server/session';
import { describeWriteError, assertAffected } from '@/domain/conflicts';
import { defaultFollowupRule } from '@/domain/followup';

const PatientInput = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  birth_date: z.string().optional().nullable(),
  sex: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().or(z.literal('')).nullable(),
  address: z.string().optional().nullable(),
  payer_type: z.enum(['philhealth', 'hmo', 'cash', 'referral']),
  hmo_name: z.string().optional().nullable(),
  philhealth_no: z.string().optional().nullable(),
  referring_physician_id: z.string().uuid().optional().nullable(),
});

const EpisodeInput = z.object({
  patient_id: z.string().uuid(),
  diagnosis: z.string().min(1, 'Diagnosis is required'),
  icd10_code: z.string().optional().nullable(),
  case_type: z.enum(['msk', 'neuro', 'pedia', 'other']),
  followup_rule: z.enum(['every_6_sessions', 'monthly']).optional(),
  primary_therapist_id: z.string().uuid().optional().nullable(),
});

export async function createPatient(form: FormData) {
  const staff = await requireRole('owner', 'admin');
  const parsed = PatientInput.parse(Object.fromEntries(form));
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('patients')
    .insert({ ...parsed, email: parsed.email || null, clinic_id: staff.clinic_id })
    .select('id')
    .single();

  if (error) throw new Error(describeWriteError(error) ?? error.message);
  revalidatePath('/patients');
  return data.id as string;
}

export async function updatePatient(patientId: string, form: FormData) {
  await requireRole('owner', 'admin');
  const parsed = PatientInput.partial().parse(Object.fromEntries(form));
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('patients').update(parsed).eq('id', patientId).select('id');

  if (error) throw new Error(describeWriteError(error) ?? error.message);
  // RLS refuses by matching no rows rather than erroring.
  assertAffected(data?.length, 'The patient record');
  revalidatePath(`/patients/${patientId}`);
}

export async function createEpisode(form: FormData) {
  const staff = await requireRole('owner', 'admin');
  const raw = Object.fromEntries(form);
  const parsed = EpisodeInput.parse(raw);
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('episodes')
    .insert({
      ...parsed,
      followup_rule: parsed.followup_rule ?? defaultFollowupRule(parsed.case_type),
      clinic_id: staff.clinic_id,
    })
    .select('id')
    .single();

  if (error) throw new Error(describeWriteError(error) ?? error.message);
  revalidatePath(`/patients/${parsed.patient_id}`);
  return data.id as string;
}

export async function listPatients(search?: string) {
  await requireStaff();
  const supabase = await supabaseServer();
  let query = supabase
    .from('patients')
    .select('id, first_name, last_name, birth_date, phone, payer_type, hmo_name, clinic_id')
    .order('last_name');

  if (search) query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}
