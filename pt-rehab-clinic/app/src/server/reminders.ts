'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { requireRole } from '@/server/session';
import { logAudit } from '@/server/audit';
import { messageSender } from '@/server/providers';
import { assertAffected, describeWriteError } from '@/domain/conflicts';

/**
 * The reminder queue (spec §10).
 *
 * Nothing sends without a staff member approving it — birthdays included. The
 * generator only drafts; approval and sending are separate, explicit actions,
 * and each send writes an audit entry.
 */
export async function listReminderQueue(status: 'queued' | 'approved' | 'sent' | 'failed' = 'queued') {
  await requireRole('owner', 'admin');
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('reminders')
    .select(`id, kind, channel, scheduled_for, draft_body, status, sent_at, error,
             patients:patient_id(first_name, last_name, phone, email),
             clinics:clinic_id(name)`)
    .eq('status', status)
    .order('scheduled_for');

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function editReminderDraft(reminderId: string, draftBody: string) {
  await requireRole('owner', 'admin');
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from('reminders').update({ draft_body: draftBody }).eq('id', reminderId).select('id');
  if (error) throw new Error(describeWriteError(error) ?? error.message);
  assertAffected(data?.length, 'The reminder');
  revalidatePath('/reminders');
}

export async function approveReminders(reminderIds: string[]) {
  const staff = await requireRole('owner', 'admin');
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('reminders')
    .update({ status: 'approved', approved_by: staff.id, approved_at: new Date().toISOString() })
    .in('id', reminderIds)
    .eq('status', 'queued')
    .select('id');

  if (error) throw new Error(describeWriteError(error) ?? error.message);
  revalidatePath('/reminders');
  return data?.length ?? 0;
}

export async function skipReminder(reminderId: string) {
  await requireRole('owner', 'admin');
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from('reminders').update({ status: 'skipped' }).eq('id', reminderId);
  if (error) throw new Error(describeWriteError(error) ?? error.message);
  revalidatePath('/reminders');
}

/** Sends one approved reminder. A queued (unapproved) reminder is refused. */
export async function sendReminder(reminderId: string) {
  await requireRole('owner', 'admin');
  const supabase = await supabaseServer();

  const { data: reminder, error } = await supabase
    .from('reminders')
    .select('id, kind, channel, draft_body, status, patient_id, patients:patient_id(first_name, phone, email)')
    .eq('id', reminderId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!reminder) throw new Error('That reminder is not visible to you.');
  if (reminder.status !== 'approved') {
    throw new Error('Reminders must be reviewed and approved before they can be sent.');
  }

  const patient = reminder.patients as unknown as { first_name: string; phone: string | null; email: string | null };
  const sender = messageSender();

  try {
    const result = reminder.channel === 'sms'
      ? await sender.sendSms(patient.phone ?? '', reminder.draft_body)
      : await sender.sendEmail(patient.email ?? '', 'A message from your clinic', reminder.draft_body);

    await supabase.from('reminders').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      provider_message_id: result.providerMessageId,
      error: null,
    }).eq('id', reminderId);

    await logAudit({
      action: 'send',
      entityType: 'reminders',
      entityId: reminderId,
      patientId: reminder.patient_id,
      summary: `Sent ${reminder.kind} reminder by ${reminder.channel}`,
    });
  } catch (err) {
    await supabase.from('reminders')
      .update({ status: 'failed', error: (err as Error).message }).eq('id', reminderId);
    throw err;
  }

  revalidatePath('/reminders');
}
