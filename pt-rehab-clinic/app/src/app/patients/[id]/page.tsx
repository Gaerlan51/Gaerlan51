import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff, can } from '@/server/session';
import { getPatientChart } from '@/server/audit';
import { followupLabel, ruleExplanation } from '@/domain/followup';
import { listTemplates } from '@/server/programs';
import {
  createEpisodeAction, startConsultAction, finalizeEncounterAction, addendumAction,
  createProgramAction, signProgramAction, createDocumentAction, signDocumentAction,
} from '@/server/actions';
import { Card, Badge, Field, Empty } from '@/components/ui';
import type { FollowupRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  md_consult: 'MD consultation',
  therapy_session: 'Therapy session',
  acupuncture: 'Acupuncture',
  referral_back: 'Referral back to physician',
  referral_out: 'Referral to other facility',
  prescription: 'Prescription',
};

export default async function PatientChartPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;

  // Reading a chart is logged, always. That is why this page does not query
  // the patients table directly (spec §6).
  const chart = await getPatientChart(id);
  if (!chart) notFound();

  const { patient, episodes, encounters, programs, documents, appointments, followups } = chart;
  const activeEpisode = episodes.find((e) => e.status === 'active') ?? episodes[0];
  const templates = can.seeClinicalNotes(staff) ? await listTemplates() : [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{patient.last_name}, {patient.first_name}</h1>
          <p className="text-sm text-slate-500">
            {patient.birth_date ?? 'DOB unknown'} · {patient.phone ?? 'no mobile on file'} ·{' '}
            <Badge>{patient.payer_type === 'hmo' && patient.hmo_name ? patient.hmo_name : patient.payer_type}</Badge>
          </p>
        </div>
        <Link href={`/schedule?patient=${patient.id}`} className="btn-ghost">Book appointment</Link>
      </header>

      {/* Follow-up status: read from v_followup_due, never recomputed here. */}
      {(followups as FollowupRow[]).map((row) => (
        <div key={row.episode_id}
             className={`rounded-md border p-3 ${row.is_due ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
          <p className="text-sm font-medium">{followupLabel(row)}</p>
          <p className="text-xs text-slate-600">{ruleExplanation(row)}</p>
        </div>
      ))}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Episodes of care">
          {episodes.length === 0 ? <Empty>No episode recorded yet.</Empty> : (
            <ul className="space-y-2">
              {episodes.map((e) => (
                <li key={e.id} className="rounded border border-slate-200 p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{e.diagnosis}</span>
                    <Badge tone={e.status === 'active' ? 'ok' : 'neutral'}>{e.status}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    {e.case_type} · {e.followup_rule === 'monthly' ? 'monthly review' : 'review every 6 sessions'} ·
                    started {e.started_on}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {can.schedule(staff) && (
            <form action={createEpisodeAction} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
              <input type="hidden" name="patient_id" value={patient.id} />
              <Field label="New episode — diagnosis">
                <input className="input" name="diagnosis" required />
              </Field>
              <Field label="Case type" hint="Sets the follow-up rule; the doctor can override it">
                <select className="input" name="case_type" defaultValue="msk">
                  <option value="msk">Musculoskeletal — review every 6 sessions</option>
                  <option value="neuro">Neurologic — review every 6 sessions</option>
                  <option value="pedia">Paediatric — monthly review</option>
                  <option value="other">Other — review every 6 sessions</option>
                </select>
              </Field>
              <button className="btn-ghost">Add episode</button>
            </form>
          )}
        </Card>

        <Card title="Encounters">
          {encounters.length === 0 ? <Empty>No encounters recorded.</Empty> : (
            <ul className="space-y-2">
              {encounters.slice(0, 12).map((e) => (
                <li key={e.id} className="rounded border border-slate-200 p-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{KIND_LABEL[e.kind] ?? e.kind}</span>
                    <Badge tone={e.status === 'final' ? 'ok' : 'draft'}>{e.status}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    {new Date(e.occurred_at).toLocaleString('en-PH')}
                    {e.addendum_of ? ' · addendum' : ''}
                  </p>
                  {can.seeClinicalNotes(staff) && e.status === 'draft' && (
                    <form action={finalizeEncounterAction} className="mt-2">
                      <input type="hidden" name="encounter_id" value={e.id} />
                      <input type="hidden" name="patient_id" value={patient.id} />
                      <button className="btn-ghost text-xs">Finalize note</button>
                    </form>
                  )}
                  {can.seeClinicalNotes(staff) && e.status === 'final' && (
                    <form action={addendumAction} className="mt-2">
                      <input type="hidden" name="encounter_id" value={e.id} />
                      <input type="hidden" name="patient_id" value={patient.id} />
                      <input type="hidden" name="episode_id" value={e.episode_id ?? ''} />
                      <button className="btn-ghost text-xs">File addendum</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}

          {can.seeClinicalNotes(staff) && (
            <form action={startConsultAction} className="mt-3 border-t border-slate-100 pt-3">
              <input type="hidden" name="patient_id" value={patient.id} />
              <input type="hidden" name="episode_id" value={activeEpisode?.id ?? ''} />
              <button className="btn-primary text-xs">Start consultation note</button>
            </form>
          )}
          {!can.seeClinicalNotes(staff) && (
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
              Consultation contents are not shown to front-desk accounts. You can see that an
              encounter took place, not what it recorded.
            </p>
          )}
        </Card>

        <Card title="Therapy programmes">
          {programs.length === 0 ? <Empty>No programme yet.</Empty> : (
            <ul className="space-y-2">
              {programs.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-2 text-sm">
                  <span>
                    <span className="font-medium">{p.title}</span>
                    <span className="ml-2 text-xs text-slate-500">{p.discipline}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={p.status === 'signed' ? 'ok' : 'draft'}>{p.status}</Badge>
                    <a className="btn-ghost text-xs" href={`/api/programs/${p.id}/pdf`} target="_blank">PDF</a>
                    {can.sign(staff) && p.status === 'draft' && (
                      <form action={signProgramAction}>
                        <input type="hidden" name="program_id" value={p.id} />
                        <input type="hidden" name="patient_id" value={patient.id} />
                        <button className="btn-ghost text-xs">Sign</button>
                      </form>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {can.seeClinicalNotes(staff) && (
            <form action={createProgramAction} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
              <input type="hidden" name="patient_id" value={patient.id} />
              <input type="hidden" name="episode_id" value={activeEpisode?.id ?? ''} />
              <Field label="Programme title"><input className="input" name="title" required /></Field>
              <Field label="Discipline">
                <select className="input" name="discipline" defaultValue="PT">
                  <option>PT</option><option>OT</option><option>Speech</option>
                  <option>Psych</option><option>PO</option>
                </select>
              </Field>
              <Field label="Start from template"
                     hint={templates.length === 0
                       ? 'The template library is empty until the doctor supplies protocols (spec §15).'
                       : undefined}>
                <select className="input" name="template_id" defaultValue="">
                  <option value="">Blank programme</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.discipline})</option>)}
                </select>
              </Field>
              <button className="btn-ghost">Create programme</button>
            </form>
          )}
        </Card>

        <Card title="Documents">
          {documents.length === 0 ? <Empty>No referral letters or prescriptions.</Empty> : (
            <ul className="space-y-2">
              {documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-2 text-sm">
                  <span>
                    <span className="font-medium">{d.title}</span>
                    <span className="ml-2 text-xs text-slate-500">{KIND_LABEL[d.kind] ?? d.kind}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={d.status === 'signed' ? 'ok' : d.status === 'voided' ? 'neutral' : 'draft'}>
                      {d.status === 'signed' ? 'signed' : d.status === 'voided' ? 'voided' : 'DRAFT'}
                    </Badge>
                    <a className="btn-ghost text-xs" href={`/api/documents/${d.id}/pdf`} target="_blank">PDF</a>
                    {can.sign(staff) && d.status === 'draft' && (
                      <form action={signDocumentAction}>
                        <input type="hidden" name="document_id" value={d.id} />
                        <input type="hidden" name="patient_id" value={patient.id} />
                        <button className="btn-ghost text-xs">Sign</button>
                      </form>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {can.schedule(staff) && (
            <form action={createDocumentAction} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
              <input type="hidden" name="patient_id" value={patient.id} />
              <input type="hidden" name="episode_id" value={activeEpisode?.id ?? ''} />
              <Field label="Document type">
                <select className="input" name="kind" defaultValue="referral_back">
                  <option value="referral_back">Referral back to referring physician</option>
                  <option value="referral_out">Referral to other facility</option>
                  <option value="prescription">Prescription</option>
                </select>
              </Field>
              <Field label="Title"><input className="input" name="title" required /></Field>
              <Field label="Addressed to"><input className="input" name="recipient" /></Field>
              <Field label="Body"><textarea className="input" name="text" rows={4} /></Field>
              <p className="text-xs text-slate-500">
                Saved as a draft. Printed copies carry a “DRAFT — NOT VALID FOR DISPENSING”
                watermark until the doctor signs.
              </p>
              <button className="btn-ghost">Create draft</button>
            </form>
          )}
        </Card>
      </div>

      <Card title="Appointments">
        {appointments.length === 0 ? <Empty>Nothing scheduled.</Empty> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {appointments.slice(0, 10).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{new Date(a.starts_at).toLocaleString('en-PH')}</span>
                <span className="text-slate-500">{KIND_LABEL[a.kind] ?? a.kind}</span>
                <Badge tone={a.status === 'completed' ? 'ok' : a.status === 'no_show' ? 'danger' : 'neutral'}>
                  {a.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
