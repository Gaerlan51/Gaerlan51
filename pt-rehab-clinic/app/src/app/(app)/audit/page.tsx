import { requireRole } from '@/server/session';
import { listAuditEntries } from '@/server/export';
import { Card, Badge, Empty, PageHeader, TableWrap } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Spec §6 — without a viewer, the audit log is compliance theatre. */
export default async function AuditPage({
  searchParams,
}: { searchParams: Promise<{ patient?: string; from?: string; to?: string }> }) {
  await requireRole('owner', 'admin');
  const sp = await searchParams;
  const entries = await listAuditEntries({ patientId: sp.patient, from: sp.from, to: sp.to });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit log"
        lead="Who viewed, changed, printed, exported or sent each record. Append-only — no account can edit or delete an entry, including the owner's."
      />

      <form className="flex flex-wrap gap-2">
        <input className="input max-w-xs" name="patient" placeholder="Patient ID" defaultValue={sp.patient} />
        <input className="input max-w-[180px]" type="date" name="from" defaultValue={sp.from} />
        <input className="input max-w-[180px]" type="date" name="to" defaultValue={sp.to} />
        <button className="btn-ghost">Filter</button>
      </form>

      <Card>
        {entries.length === 0 ? <Empty>No matching entries.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  <th className="th">When</th><th className="th">Who</th><th className="th">Action</th>
                  <th className="th">Record</th><th className="th">Detail</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const actor = e.actor as unknown as { full_name: string } | null;
                  return (
                    <tr key={e.id}>
                      <td className="td whitespace-nowrap">{new Date(e.occurred_at).toLocaleString('en-PH')}</td>
                      <td className="td">{actor?.full_name ?? '—'}<span className="ml-1 text-xs text-muted">{e.actor_role}</span></td>
                      <td className="td">
                        <Badge tone={e.action === 'sign' ? 'ok' : e.action === 'view' ? 'neutral' : 'draft'}>
                          {e.action}
                        </Badge>
                      </td>
                      <td className="td">{e.entity_type}</td>
                      <td className="td text-muted">{e.summary ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
