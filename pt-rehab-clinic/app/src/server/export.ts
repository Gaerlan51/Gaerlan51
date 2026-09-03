'use server';
import { supabaseServer } from '@/lib/supabase/server';
import { requireRole } from '@/server/session';
import { logAudit } from '@/server/audit';
import { toCsv, csvFilename } from '@/domain/csv';

/**
 * Export (spec §12 and §2.4). The owner will eventually migrate to a certified
 * EMR; nothing here may be locked in a format that cannot leave.
 */
const EXPORTABLE = [
  'patients', 'episodes', 'encounters', 'appointments', 'programs', 'documents', 'reminders',
] as const;

export type Exportable = (typeof EXPORTABLE)[number];

export async function exportTableCsv(table: Exportable) {
  await requireRole('owner', 'admin');
  if (!EXPORTABLE.includes(table)) throw new Error(`${table} is not exportable.`);

  const supabase = await supabaseServer();
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  await logAudit({
    action: 'export',
    entityType: table,
    summary: `Exported ${rows.length} row(s) from ${table} as CSV`,
  });

  return { filename: csvFilename(table), csv: toCsv(rows as Record<string, unknown>[]) };
}

/** The audit log itself (spec §6): without a viewer, the log is theatre. */
export async function listAuditEntries(filters: {
  patientId?: string;
  actorStaffId?: string;
  from?: string;
  to?: string;
  limit?: number;
} = {}) {
  await requireRole('owner', 'admin');
  const supabase = await supabaseServer();

  let query = supabase
    .from('audit_log')
    .select('id, occurred_at, actor_role, action, entity_type, entity_id, patient_id, summary, actor:actor_staff_id(full_name)')
    .order('occurred_at', { ascending: false })
    .limit(filters.limit ?? 200);

  if (filters.patientId) query = query.eq('patient_id', filters.patientId);
  if (filters.actorStaffId) query = query.eq('actor_staff_id', filters.actorStaffId);
  if (filters.from) query = query.gte('occurred_at', filters.from);
  if (filters.to) query = query.lt('occurred_at', filters.to);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}
