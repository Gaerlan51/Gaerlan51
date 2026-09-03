import Link from 'next/link';
import { requireStaff, can } from '@/server/session';
import { listSchedule } from '@/server/scheduling';
import { listPatients } from '@/server/patients';
import { supabaseServer } from '@/lib/supabase/server';
import { bookAppointmentAction, completeSessionAction } from '@/server/actions';
import { Card, Badge, Field, Empty, PageHeader, Note } from '@/components/ui';

export const dynamic = 'force-dynamic';

function dayRange(dateString?: string) {
  const day = dateString ? new Date(`${dateString}T00:00:00+08:00`) : new Date();
  const from = new Date(day); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + 1);
  return { from, to, iso: from.toISOString().slice(0, 10) };
}

export default async function SchedulePage({
  searchParams,
}: { searchParams: Promise<{ date?: string; patient?: string }> }) {
  const staff = await requireStaff();
  const { date, patient } = await searchParams;
  const { from, to, iso } = dayRange(date);

  const supabase = await supabaseServer();
  const [appointments, patients, providers, rooms] = await Promise.all([
    listSchedule(from.toISOString(), to.toISOString()),
    can.schedule(staff) ? listPatients() : Promise.resolve([]),
    supabase.from('staff').select('id, full_name, discipline').eq('is_active', true)
      .eq('clinic_id', staff.clinic_id).order('full_name'),
    supabase.from('rooms').select('id, name').eq('is_active', true)
      .eq('clinic_id', staff.clinic_id).order('name'),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Schedule"
        lead="Your branch's day. Conflicts are rejected by the database, so the same slot cannot be booked twice."
        actions={
          <form className="flex items-center gap-2">
            <input className="input" type="date" name="date" defaultValue={iso}
                   aria-label="Show schedule for date" />
            <button className="btn-secondary">Go</button>
          </form>
        }
      />

      <Card title={`Appointments for ${from.toLocaleDateString('en-PH')}`}>
        {appointments.length === 0 ? <Empty>Nothing booked for this day.</Empty> : (
          <ul className="divide-y divide-line">
            {appointments.map((a) => {
              const p = a.patients as unknown as { first_name: string; last_name: string } | null;
              const provider = a.staff as unknown as { full_name: string } | null;
              const room = a.rooms as unknown as { name: string } | null;
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className="w-32 tabular-nums text-muted">
                    {new Date(a.starts_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
                    –{new Date(a.ends_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <Link href={`/patients/${a.patient_id}`} className="min-w-[140px] flex-1 font-medium text-brand hover:underline">
                    {p ? `${p.last_name}, ${p.first_name}` : 'Patient'}
                  </Link>
                  <span className="min-w-[140px] text-muted">
                    {provider?.full_name}{room ? ` · ${room.name}` : ''}
                  </span>
                  <Badge tone={a.status === 'completed' ? 'ok' : a.status === 'no_show' ? 'danger' : 'neutral'}>
                    {a.status}
                  </Badge>
                  {a.status === 'booked' && (
                    <form action={completeSessionAction}>
                      <input type="hidden" name="appointment_id" value={a.id} />
                      <button className="btn-ghost text-xs">Mark completed</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {can.schedule(staff) && (
        <Card title="Book an appointment">
          <form action={bookAppointmentAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Patient">
              <select className="input" name="patient_id" defaultValue={patient ?? ''} required>
                <option value="" disabled>Select a patient</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>{p.last_name}, {p.first_name}</option>
                ))}
              </select>
            </Field>
            <Field label="Type">
              <select className="input" name="kind" defaultValue="therapy_session">
                <option value="therapy_session">Therapy session</option>
                <option value="md_consult">MD consultation</option>
                <option value="acupuncture">Acupuncture</option>
              </select>
            </Field>
            <Field label="Provider">
              <select className="input" name="provider_id" required>
                {(providers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.full_name}{s.discipline ? ` (${s.discipline})` : ''}</option>
                ))}
              </select>
            </Field>
            <Field label="Room">
              <select className="input" name="room_id" defaultValue="">
                <option value="">No room</option>
                {(rooms.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Starts"><input className="input" type="datetime-local" name="starts_at" required /></Field>
            <Field label="Ends"><input className="input" type="datetime-local" name="ends_at" required /></Field>
            <div className="sm:col-span-2">
              <Note>
                If the therapist or room is already taken, the database refuses the booking and
                you will see exactly which clash caused it.
              </Note>
              <button className="btn-primary mt-3">Book</button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
