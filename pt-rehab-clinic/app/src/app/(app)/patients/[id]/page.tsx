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
import { Card, Badge, Field, Empty, Note } from '@/components/ui';
import { IconCalendar, IconShield } from '@/components/icons';
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
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-semibold text-brand">
            {`${patient.first_name[0] ?? ''}${patient.last_name[0] ?? ''}`.toUpperCase()}
          </span>
          <div>
            <h1 className="text-xl font-semibold sm:text-2xl">
              {patient.last_name}, {patient.first_name}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <span>{patient.birth_date ?? 'DOB unknown'}</span>
              <span aria-hidden="true">·</span>
              <span>{patient.phone ?? 'no mobile on file'}</span>
              <Badge tone="brand">
                {patient.payer_type === 'hmo' && patient.hmo_name ? patient.hmo_name : patient.payer_type}
              </Badge>
              {!patient.consent_signed_at && <Badge tone="due">Consent not recorded</Badge>}
            </div>
          </div>
        </div>
        <Link href={`/schedule?patient=${patient.id}`} className="btn-primary">
          <IconCalendar width={16} height={16} /> Book appointment
        </Link>
      </header>

      {/* Follow-up status: read from v_followup_due, never recomputed here. */}
      {(followups as FollowupRow[]).map((row) => (
        <div key={row.episode_id}
             className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
               row.is_due ? 'border-caution/40 bg-caution/5' : 'border-line bg-surface'
             }`}>
          <div>
            <p className="text-sm font-semibold">{followupLabel(row)}</p>
            <p className="mt-0.5 text-xs text-muted">{ruleExplanation(row)}</p>
          </div>
          {row.is_due && (
            <Link href={`/schedule?patient=${patient.id}`} className="btn-secondary btn-sm">
              Schedule review
            </Link>
          )}
        </div>
      ))}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Episodes of care">
          {episodes.length === 0 ? <Empty>No episode recorded yet.</Empty> : (
            <ul className="space-y-2">
              {episodes.map((e) => (
                <li key={e.id} className="rounded border border-line p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{e.diagnosis}</span>
                    <Badge tone={e.status === 'active' ? 'ok' : 'neutral'}>{e.status}</Badge>
                  </div>
                  <p className="text-xs text-muted">
                    {e.case_type} · {e.followup_rule === 'monthly' ? 'monthly review' : 'review every 6 sessions'} ·
                    started {e.started_on}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {can.schedule(staff) && (
            <form action={createEpisodeAction} className="mt-3 space-y-2 border-t border-line pt-3">
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
              <button className="btn-secondary btn-sm">Add episode</button>
            </form>
          )}
        </Card>

        <Card title="Encounters">
          {encounters.length === 0 ? <Empty>No encounters recorded.</Empty> : (
            <ul className="space-y-2">
              {encounters.slice(0, 12).map((e) => (
                <li key={e.id} className="rounded border border-line p-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{KIND_LABEL[e.kind] ?? e.kind}</span>
                    <Badge tone={e.status === 'final' ? 'ok' : 'draft'}>{e.status}</Badge>
                  </div>
                  <p className="text-xs text-muted">
                    {new Date(e.occurred_at).toLocaleString('en-PH')}
                    {e.addendum_of ? ' · addendum' : ''}
                  </p>
                  {can.seeClinicalNotes(staff) && e.status === 'draft' && (
                    <form action={finalizeEncounterAction} className="mt-2">
                      <input type="hidden" name="encounter_id" value={e.id} />
                      <input type="hidden" name="patient_id" value={patient.id} />
                      <button className="btn-secondary btn-sm">Finalize note</button>
                    </form>
                  )}
                  {can.seeClinicalNotes(staff) && e.status === 'final' && (
                    <form action={addendumAction} className="mt-2">
                      <input type="hidden" name="encounter_id" value={e.id} />
                      <input type="hidden" name="patient_id" value={patient.id} />
                      <input type="hidden" name="episode_id" value={e.episode_id ?? ''} />
                      <button className="btn-secondary btn-sm">File addendum</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}

          {can.seeClinicalNotes(staff) && (
            <form action={startConsultAction} className="mt-3 border-t border-line pt-3">
              <input type="hidden" name="patient_id" value={patient.id} />
              <input type="hidden" name="episode_id" value={activeEpisode?.id ?? ''} />
              <button className="btn-primary btn-sm">Start consultation note</button>
            </form>
          )}
          {!can.seeClinicalNotes(staff) && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted text-pretty">
                <IconShield width={14} height={14} className="mt-0.5 shrink-0" />
                Consultation contents are not shown to front-desk accounts. You can see that an
                encounter took place, not what it recorded.
              </p>
            </div>
          )}
        </Card>

        <Card title="Therapy programmes">
          {programs.length === 0 ? <Empty>No programme yet.</Empty> : (
            <ul className="space-y-2">
              {programs.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-line p-2 text-sm">
                  <span>
                    <span className="font-medium">{p.title}</span>
                    <span className="ml-2 text-xs text-muted">{p.discipline}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={p.status === 'signed' ? 'ok' : 'draft'}>{p.status}</Badge>
                    <a className="btn-secondary btn-sm" href={`/api/programs/${p.id}/pdf`} target="_blank">PDF</a>
                    {can.sign(staff) && p.status === 'draft' && (
                      <form action={signProgramAction}>
                        <input type="hidden" name="program_id" value={p.id} />
                        <input type="hidden" name="patient_id" value={patient.id} />
                        <button className="btn-secondary btn-sm">Sign</button>
                      </form>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {can.seeClinicalNotes(staff) && (
            <form action={createProgramAction} className="mt-3 space-y-2 border-t border-line pt-3">
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
              <button className="btn-secondary btn-sm">Create programme</button>
            </form>
          )}
        </Card>

        <Card title="Documents">
          {documents.length === 0 ? <Empty>No referral letters or prescriptions.</Empty> : (
            <ul className="space-y-2">
              {documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-line p-2 text-sm">
                  <span>
                    <span className="font-medium">{d.title}</span>
                    <span className="ml-2 text-xs text-muted">{KIND_LABEL[d.kind] ?? d.kind}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={d.status === 'signed' ? 'ok' : d.status === 'voided' ? 'neutral' : 'draft'}>
                      {d.status === 'signed' ? 'signed' : d.status === 'voided' ? 'voided' : 'DRAFT'}
                    </Badge>
                    <a className="btn-secondary btn-sm" href={`/api/documents/${d.id}/pdf`} target="_blank">PDF</a>
                    {can.sign(staff) && d.status === 'draft' && (
                      <form action={signDocumentAction}>
                        <input type="hidden" name="document_id" value={d.id} />
                        <input type="hidden" name="patient_id" value={patient.id} />
                        <button className="btn-secondary btn-sm">Sign</button>
                      </form>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {can.schedule(staff) && (
            <form action={createDocumentAction} className="mt-3 space-y-2 border-t border-line pt-3">
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
              <Note tone="caution">
                Saved as a draft. Printed copies carry a “DRAFT — NOT VALID FOR DISPENSING”
                watermark until the doctor signs.
              </Note>
              <button className="btn-secondary btn-sm">Create draft</button>
            </form>
          )}
        </Card>
      </div>

      <Card title="Appointments">
        {appointments.length === 0 ? <Empty>Nothing scheduled.</Empty> : (
          <ul className="divide-y divide-line text-sm">
            {appointments.slice(0, 10).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{new Date(a.starts_at).toLocaleString('en-PH')}</span>
                <span className="text-muted">{KIND_LABEL[a.kind] ?? a.kind}</span>
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
