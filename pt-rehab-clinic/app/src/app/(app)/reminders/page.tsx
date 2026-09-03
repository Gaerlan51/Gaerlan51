import { requireRole } from '@/server/session';
import { listReminderQueue } from '@/server/reminders';
import { approveRemindersAction, sendReminderAction, skipReminderAction } from '@/server/actions';
import { Card, Badge, Empty, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

const KIND_LABEL = {
  appointment: 'Appointment reminder',
  birthday: 'Birthday greeting',
  followup_due: 'Follow-up due',
} as const;

/**
 * Spec §10. Nothing here sends on its own — birthdays included. Drafts are
 * reviewed, approved, then sent as an explicit action that is audited.
 */
export default async function RemindersPage({
  searchParams,
}: { searchParams: Promise<{ status?: 'queued' | 'approved' | 'sent' | 'failed' }> }) {
  await requireRole('owner', 'admin');
  const status = (await searchParams).status ?? 'queued';
  const reminders = await listReminderQueue(status);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reminder queue"
        lead="Nothing sends on its own — birthdays included. A person approves each message, and every send is audited."
        actions={
          <nav aria-label="Reminder status"
               className="inline-flex rounded-lg border border-line bg-surface p-1">
            {(['queued', 'approved', 'sent', 'failed'] as const).map((s) => (
              <a key={s} href={`/reminders?status=${s}`}
                 aria-current={status === s ? 'true' : undefined}
                 className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${
                   status === s ? 'bg-brand text-brand-ink' : 'text-muted hover:text-ink'
                 }`}>
                {s}
              </a>
            ))}
          </nav>
        }
      />

      <Card>
        {reminders.length === 0 ? (
          <Empty>Nothing {status} right now.</Empty>
        ) : (
          <form action={approveRemindersAction} className="space-y-3">
            {reminders.map((r) => {
              const patient = r.patients as unknown as
                { first_name: string; last_name: string; phone: string | null; email: string | null } | null;
              return (
                <div key={r.id} className="rounded border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {status === 'queued' && (
                      <input type="checkbox" name="reminder_id" value={r.id} defaultChecked />
                    )}
                    <span className="font-medium text-sm">
                      {patient?.last_name}, {patient?.first_name}
                    </span>
                    <Badge>{KIND_LABEL[r.kind as keyof typeof KIND_LABEL] ?? r.kind}</Badge>
                    <Badge tone="neutral">{r.channel}</Badge>
                    <span className="text-xs text-muted">
                      {r.channel === 'sms' ? patient?.phone : patient?.email}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap rounded bg-raised p-2 text-sm">{r.draft_body}</p>
                  {r.error ? <p className="mt-1 text-xs text-critical">{r.error}</p> : null}

                  <div className="mt-2 flex gap-2">
                    {status === 'approved' && (
                      <button formAction={sendReminderAction} name="reminder_id" value={r.id}
                              className="btn-primary text-xs">
                        Send now
                      </button>
                    )}
                    {status !== 'sent' && (
                      <button formAction={skipReminderAction} name="reminder_id" value={r.id}
                              className="btn-ghost text-xs">
                        Skip
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {status === 'queued' && (
              <div className="flex justify-end border-t border-line pt-3">
                <button className="btn-primary">Approve selected</button>
              </div>
            )}
          </form>
        )}
      </Card>
    </div>
  );
}
