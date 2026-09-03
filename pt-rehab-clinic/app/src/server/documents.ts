'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { requireRole, requireStaff } from '@/server/session';
import { describeWriteError, assertAffected } from '@/domain/conflicts';
import { logAudit } from '@/server/audit';

const DocumentInput = z.object({
  patient_id: z.string().uuid(),
  episode_id: z.string().uuid().optional().nullable(),
  kind: z.enum(['referral_back', 'referral_out', 'prescription']),
  title: z.string().min(1),
  body: z.record(z.unknown()),
});

/**
 * Referral letters and prescriptions (spec §9).
 *
 * Documents are always created as drafts — the database forces this regardless
 * of what is passed — and only the owner/doctor role can sign. Nothing in this
 * module, or anywhere else, signs a document automatically.
 */
export async function createDocument(input: z.input<typeof DocumentInput>) {
  const staff = await requireRole('owner', 'admin');
  const parsed = DocumentInput.parse(input);
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('documents')
    .insert({ ...parsed, clinic_id: staff.clinic_id, status: 'draft' })
    .select('id')
    .single();

  if (error) throw new Error(describeWriteError(error) ?? error.message);
  revalidatePath(`/patients/${parsed.patient_id}`);
  return data.id as string;
}

export async function updateDocumentBody(documentId: string, body: Record<string, unknown>) {
  await requireRole('owner', 'admin');
  const supabase = await supabaseServer();

  // If the document was signed, the trigger reverts it to draft: a signature
  // must never outlive the text it was applied to.
  const { data, error } = await supabase
    .from('documents').update({ body }).eq('id', documentId).select('id, status');

  if (error) throw new Error(describeWriteError(error) ?? error.message);
  assertAffected(data?.length, 'The document');
  return data![0];
}

/** Only the doctor reaches this, and RLS plus a trigger both enforce it. */
export async function signDocument(documentId: string, patientId: string) {
  await requireRole('owner');
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('documents').update({ status: 'signed' }).eq('id', documentId)
    .select('id, status, signed_at, content_hash');

  if (error) throw new Error(describeWriteError(error) ?? error.message);
  assertAffected(data?.length, 'The signature');
  revalidatePath(`/patients/${patientId}`);
  return data![0];
}

export async function voidDocument(documentId: string, patientId: string) {
  await requireRole('owner');
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from('documents').update({ status: 'voided' }).eq('id', documentId).select('id');
  if (error) throw new Error(describeWriteError(error) ?? error.message);
  assertAffected(data?.length, 'The document');
  revalidatePath(`/patients/${patientId}`);
}

export async function getDocumentForPrint(documentId: string) {
  await requireStaff();
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('documents')
    .select(`*, patients:patient_id(first_name, last_name, birth_date, address),
             clinics:clinic_id(name, address, phone, letterhead_url),
             signer:signed_by(full_name, prc_license_no)`)
    .eq('id', documentId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  // Printing is a disclosure event, so it is logged like a read (spec §6).
  await logAudit({
    action: 'print',
    entityType: 'documents',
    entityId: documentId,
    patientId: data.patient_id,
    summary: `Printed ${data.kind} (${data.status})`,
  });

  return data;
}
