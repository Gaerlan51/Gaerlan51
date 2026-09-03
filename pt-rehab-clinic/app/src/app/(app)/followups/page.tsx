import Link from 'next/link';
import { requireStaff } from '@/server/session';
import { listFollowupsDue } from '@/server/followup';
import { followupLabel, ruleExplanation } from '@/domain/followup';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { IconArrow } from '@/components/icons';

export const dynamic = 'force-dynamic';

/** Spec §8 — reads v_followup_due, the single definition of the rule. */
export default async function FollowupsPage() {
  await requireStaff();
  const rows = await listFollowupsDue(true);

  return (
    <>
      <PageHeader
        title="Due for MD follow-up"
        lead="Every 6 therapy sessions for musculoskeletal and neurologic cases; monthly for paediatric rehab. Flagged automatically — nobody has to remember."
      />

      {rows.length === 0 ? (
        <Card>
          <Empty action={<Link href="/schedule" className="btn-secondary btn-sm">Open schedule</Link>}>
            No patients are due for review right now.
          </Empty>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.episode_id}>
              <article className="card-interactive flex flex-wrap items-center gap-4">
                <div className="min-w-[180px] flex-1">
                  <Link href={`/patients/${row.patient_id}`}
                        className="font-semibold text-brand hover:underline">
                    {row.patients?.last_name}, {row.patients?.first_name}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted">
                    {row.diagnosis} · {row.clinics?.name}
                  </p>
                </div>

                <div className="min-w-[220px] flex-1">
                  <Badge tone="due">{followupLabel(row)}</Badge>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">{ruleExplanation(row)}</p>
                </div>

                {row.patients?.phone ? (
                  <a href={`tel:${row.patients.phone}`} className="text-sm text-muted hover:text-ink">
                    {row.patients.phone}
                  </a>
                ) : null}

                <Link href={`/schedule?patient=${row.patient_id}`} className="btn-secondary btn-sm">
                  Book consult <IconArrow width={14} height={14} />
                </Link>
              </article>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
