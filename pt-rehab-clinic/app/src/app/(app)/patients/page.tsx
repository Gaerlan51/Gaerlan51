import Link from 'next/link';
import { requireStaff, can } from '@/server/session';
import { listPatients } from '@/server/patients';
import { PageHeader, Card, Badge, Empty, TableWrap } from '@/components/ui';
import { IconUsers } from '@/components/icons';

export const dynamic = 'force-dynamic';

function initials(first: string, last: string) {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

function payerLabel(payer: string, hmo: string | null) {
  if (payer === 'hmo') return hmo || 'HMO';
  if (payer === 'philhealth') return 'PhilHealth';
  if (payer === 'referral') return 'Referral';
  return 'Cash';
}

export default async function PatientsPage({
  searchParams,
}: { searchParams: Promise<{ q?: string }> }) {
  const staff = await requireStaff();
  const q = (await searchParams).q;
  const patients = await listPatients(q);

  return (
    <>
      <PageHeader
        title="Patients"
        lead={
          staff.role === 'therapist'
            ? 'Patients assigned to you at this branch.'
            : 'Everyone registered at your branch. Other branches’ patients are not visible here.'
        }
        actions={
          can.schedule(staff)
            ? <Link href="/patients/new" className="btn-primary">Register patient</Link>
            : undefined
        }
      />

      <form className="mb-5 flex gap-2" role="search">
        <input
          className="input max-w-xs" name="q" defaultValue={q}
          placeholder="Search by name" aria-label="Search patients by name"
        />
        <button className="btn-secondary">Search</button>
        {q ? <Link href="/patients" className="btn-ghost">Clear</Link> : null}
      </form>

      <Card>
        {patients.length === 0 ? (
          <Empty
            action={
              can.schedule(staff)
                ? <Link href="/patients/new" className="btn-primary btn-sm">Register the first patient</Link>
                : undefined
            }
          >
            {q ? `No patients match “${q}”.` : 'No patients registered at this branch yet.'}
          </Empty>
        ) : (
          <>
            <TableWrap minWidth={620}>
              <thead>
                <tr>
                  <th className="th">Patient</th>
                  <th className="th">Date of birth</th>
                  <th className="th">Payer</th>
                  <th className="th">Mobile</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((p) => (
                  <tr key={p.id} className="transition hover:bg-raised/50">
                    <td className="td">
                      <Link href={`/patients/${p.id}`} className="flex items-center gap-3 group">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-semibold text-brand">
                          {initials(p.first_name, p.last_name)}
                        </span>
                        <span className="font-medium text-brand group-hover:underline">
                          {p.last_name}, {p.first_name}
                        </span>
                      </Link>
                    </td>
                    <td className="td text-muted">{p.birth_date ?? '—'}</td>
                    <td className="td"><Badge>{payerLabel(p.payer_type, p.hmo_name)}</Badge></td>
                    <td className="td text-muted">{p.phone ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <p className="mt-4 flex items-center gap-1.5 text-xs text-muted">
              <IconUsers width={14} height={14} />
              {patients.length} patient{patients.length === 1 ? '' : 's'}. Opening a chart is
              recorded in the audit log.
            </p>
          </>
        )}
      </Card>
    </>
  );
}
