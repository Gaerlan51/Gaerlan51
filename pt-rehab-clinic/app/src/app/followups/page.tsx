import Link from 'next/link';
import { requireStaff } from '@/server/session';
import { listFollowupsDue } from '@/server/followup';
import { followupLabel, ruleExplanation } from '@/domain/followup';
import { Card, Badge, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Spec §8 — reads v_followup_due, the single definition of the rule. */
export default async function FollowupsPage() {
  await requireStaff();
  const rows = await listFollowupsDue(true);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Due for MD follow-up</h1>
        <p className="text-sm text-slate-500">
          Every 6 therapy sessions for musculoskeletal and neurologic cases; monthly for
          paediatric rehab cases.
        </p>
      </div>

      <Card>
        {rows.length === 0 ? (
          <Empty>No patients are due for review right now.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((row) => (
              <li key={row.episode_id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-[200px] flex-1">
                  <Link href={`/patients/${row.patient_id}`} className="font-medium text-brand hover:underline">
                    {row.patients?.last_name}, {row.patients?.first_name}
                  </Link>
                  <p className="text-xs text-slate-500">{row.diagnosis} · {row.clinics?.name}</p>
                </div>
                <div className="min-w-[220px] flex-1">
                  <Badge tone="due">{followupLabel(row)}</Badge>
                  <p className="mt-1 text-xs text-slate-500">{ruleExplanation(row)}</p>
                </div>
                <Link href={`/schedule?patient=${row.patient_id}`} className="btn-ghost">
                  Book consult
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
