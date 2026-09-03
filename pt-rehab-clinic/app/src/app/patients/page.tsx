import Link from 'next/link';
import { requireStaff } from '@/server/session';
import { listPatients } from '@/server/patients';
import { Card, Badge, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function PatientsPage({
  searchParams,
}: { searchParams: Promise<{ q?: string }> }) {
  await requireStaff();
  const q = (await searchParams).q;
  const patients = await listPatients(q);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Patients</h1>
        <Link href="/patients/new" className="btn-primary">Register patient</Link>
      </div>

      <form className="flex gap-2">
        <input className="input max-w-xs" name="q" defaultValue={q} placeholder="Search by name" />
        <button className="btn-ghost">Search</button>
      </form>

      <Card>
        {patients.length === 0 ? (
          <Empty>No patients yet. Register the first one to begin.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr><th className="th">Patient</th><th className="th">Date of birth</th>
                  <th className="th">Payer</th><th className="th">Phone</th></tr>
              </thead>
              <tbody>
                {patients.map((p) => (
                  <tr key={p.id}>
                    <td className="td">
                      <Link href={`/patients/${p.id}`} className="font-medium text-brand hover:underline">
                        {p.last_name}, {p.first_name}
                      </Link>
                    </td>
                    <td className="td">{p.birth_date ?? '—'}</td>
                    <td className="td">
                      <Badge>{p.payer_type === 'hmo' && p.hmo_name ? p.hmo_name : p.payer_type}</Badge>
                    </td>
                    <td className="td">{p.phone ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
