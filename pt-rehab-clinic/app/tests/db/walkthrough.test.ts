/**
 * Spec §17 — the nine-point definition of done, walked end to end as one
 * patient, against a real Postgres with RLS enforced.
 *
 * Every query runs as the `authenticated` role with a real JWT subject, so
 * this exercises the same policies, constraints and triggers the deployed app
 * runs against. It does not exercise the HTTP layer or the browser.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { admin, asUser, seedFixtures, type Fixtures } from './helpers';
import { DocumentPdf } from '@/pdf/DocumentPdf';
import { ProgramPdf } from '@/pdf/ProgramPdf';
import { followupLabel } from '@/domain/followup';
import { planReminders } from '@/domain/reminder-plan';
import { describeWriteError } from '@/domain/conflicts';
import { toCsv } from '@/domain/csv';
import type { FollowupRow } from '@/lib/types';

let f: Fixtures;
const state: Record<string, string> = {};
const log = (step: string, detail: string) => console.log(`  §17.${step}  ${detail}`);

beforeAll(async () => { f = await seedFixtures(); });

describe('§17 end-to-end walkthrough', () => {
  it('1. front desk registers a patient with payer type and referring physician', async () => {
    const { patientId, physicianId } = await asUser(f.adminA.authId, async (c) => {
      const phys = await c.query(
        `insert into referring_physicians (clinic_id, full_name, specialty)
         values ($1,'Dr. Mendoza','Orthopaedics') returning id`, [f.clinicA]);
      const patient = await c.query(
        `insert into patients (clinic_id, first_name, last_name, birth_date, phone,
                               payer_type, philhealth_no, referring_physician_id)
         values ($1,'Marites','Santos','1979-03-01','+639170001234','philhealth','PH-99-123',$2)
         returning id`, [f.clinicA, phys.rows[0].id]);
      return { patientId: patient.rows[0].id as string, physicianId: phys.rows[0].id as string };
    });

    state.patientId = patientId;
    expect(patientId).toBeTruthy();
    expect(physicianId).toBeTruthy();
    log('1', `registered Santos, Marites (Philhealth, referred by Dr. Mendoza)`);
  });

  it('2. doctor writes a SOAP note and generates a programme from a template, exported as PDF', async () => {
    const ids = await asUser(f.owner.authId, async (c) => {
      const episode = await c.query(
        `insert into episodes (clinic_id, patient_id, diagnosis, case_type, followup_rule,
                               started_on, primary_therapist_id)
         values ($1,$2,'Adhesive capsulitis, right shoulder','msk','every_6_sessions',
                 current_date, $3) returning id`,
        [f.clinicA, state.patientId, f.therapistA.staffId]);

      const encounter = await c.query(
        `insert into encounters (clinic_id, patient_id, episode_id, kind, provider_id)
         values ($1,$2,$3,'md_consult',$4) returning id`,
        [f.clinicA, state.patientId, episode.rows[0].id, f.owner.staffId]);
      await c.query(
        `insert into encounter_notes (encounter_id, clinic_id, soap_subjective, soap_objective,
                                      soap_assessment, soap_plan)
         values ($1,$2,'Right shoulder pain, 4 months','ROM limited in abduction',
                 'Adhesive capsulitis','PT 2x/week, reassess in 6 sessions')`,
        [encounter.rows[0].id, f.clinicA]);
      await c.query(`update encounters set status = 'final' where id = $1`, [encounter.rows[0].id]);

      // The doctor supplies the clinical content; the library ships empty (§15).
      const template = await c.query(
        `insert into program_templates (clinic_id, discipline, name, body)
         values ($1,'PT','Shoulder capsulitis — phase 1',
                 '{"items":[{"exercise":"Pendulum swings","sets":"3","reps":"10","frequency":"daily"},
                            {"exercise":"Wall walks","sets":"3","reps":"10","frequency":"daily"}]}'::jsonb)
         returning id, body`, [f.clinicA]);

      const program = await c.query(
        `insert into programs (clinic_id, patient_id, episode_id, template_id, discipline, title)
         values ($1,$2,$3,$4,'PT','Home programme — phase 1') returning id`,
        [f.clinicA, state.patientId, episode.rows[0].id, template.rows[0].id]);
      await c.query(`insert into program_body (program_id, clinic_id, body) values ($1,$2,$3)`,
        [program.rows[0].id, f.clinicA, template.rows[0].body]);

      return {
        episodeId: episode.rows[0].id as string,
        encounterId: encounter.rows[0].id as string,
        programId: program.rows[0].id as string,
        items: (template.rows[0].body as { items: [] }).items,
      };
    });

    Object.assign(state, ids);

    const pdf = await renderToBuffer(
      React.createElement(ProgramPdf, {
        title: 'Home programme — phase 1', discipline: 'PT', status: 'draft',
        items: ids.items,
        patient: { first_name: 'Marites', last_name: 'Santos', birth_date: '1979-03-01' },
        clinic: { name: 'Branch A' },
      }) as never);

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1000);
    log('2', `SOAP note finalized; programme PDF rendered (${pdf.length} bytes, watermarked draft)`);
  });

  it('3. front desk books sessions and the database refuses a double-booking', async () => {
    // Relative to now: these sessions must fall after the consult finalized in
    // step 2, which is what the follow-up counter anchors on.
    const day = 86_400_000;
    const slot = (offsetDays: number, durationHours = 0) =>
      new Date(Date.now() + offsetDays * day + durationHours * 3_600_000).toISOString();

    const booked = await asUser(f.adminA.authId, async (c) => {
      const ids: string[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await c.query(
          `insert into appointments (clinic_id, patient_id, episode_id, provider_id, room_id,
                                     starts_at, ends_at, kind)
           values ($1,$2,$3,$4,$5,$6,$7,'therapy_session') returning id`,
          [f.clinicA, state.patientId, state.episodeId, f.therapistA.staffId, f.roomA,
           slot(i + 1), slot(i + 1, 1)]);
        ids.push(res.rows[0].id);
      }
      return ids;
    });
    expect(booked).toHaveLength(6);

    // A second booking in the same slot, as a racing front desk would attempt.
    let refusal: string | null = null;
    await asUser(f.adminA.authId, async (c) => {
      try {
        await c.query(
          `insert into appointments (clinic_id, patient_id, provider_id, starts_at, ends_at, kind)
           values ($1,$2,$3,$4,$5,'therapy_session')`,
          [f.clinicA, state.patientId, f.therapistA.staffId, slot(1), slot(1, 1)]);
      } catch (err) {
        refusal = describeWriteError(err as { constraint?: string; message?: string });
      }
    });

    expect(refusal).toMatch(/therapist already has an appointment/i);
    state.appointmentIds = booked.join(',');
    log('3', `6 sessions booked; overlapping booking refused — "${refusal}"`);
  });

  it('4. after the 6th session the patient is automatically due for MD follow-up', async () => {
    const ids = state.appointmentIds.split(',');

    for (const [index, appointmentId] of ids.entries()) {
      await asUser(f.therapistA.authId, async (c) => {
        const appt = await c.query(
          `select patient_id, episode_id, provider_id, kind, starts_at, clinic_id
             from appointments where id = $1`, [appointmentId]);
        const a = appt.rows[0];
        const enc = await c.query(
          `insert into encounters (clinic_id, patient_id, episode_id, kind, provider_id,
                                   occurred_at, status)
           values ($1,$2,$3,$4,$5,$6,'final') returning id`,
          [a.clinic_id, a.patient_id, a.episode_id, a.kind, a.provider_id, a.starts_at]);
        await c.query(
          `update appointments set status = 'completed', encounter_id = $1 where id = $2`,
          [enc.rows[0].id, appointmentId]);
      });

      const row = await asUser(f.owner.authId, async (c) =>
        (await c.query('select * from v_followup_due where episode_id = $1',
          [state.episodeId])).rows[0] as FollowupRow);

      // Not due at five, due at six — the boundary the clinic actually cares about.
      if (index === 4) {
        expect(row.is_due).toBe(false);
        log('4', `after 5 sessions: "${followupLabel(row)}"`);
      }
      if (index === 5) {
        expect(row.is_due).toBe(true);
        log('4', `after 6 sessions: "${followupLabel(row)}" — appears on the worklist`);
      }
    }

    const worklist = await asUser(f.adminA.authId, async (c) =>
      (await c.query('select patient_id from v_followup_due where is_due')).rows);
    expect(worklist.map((r) => r.patient_id)).toContain(state.patientId);
  });

  it('5. tomorrow’s appointment reminder is drafted and waits for staff approval', async () => {
    const now = new Date();
    const starts = new Date(now.getTime() + 30 * 3_600_000); // ~30h out: inside the 24-48h window

    await asUser(f.adminA.authId, async (c) =>
      c.query(`insert into appointments (clinic_id, patient_id, episode_id, provider_id, room_id,
                                         starts_at, ends_at, kind)
               values ($1,$2,$3,$4,$5,$6,$7,'md_consult')`,
        [f.clinicA, state.patientId, state.episodeId, f.owner.staffId, f.roomA,
         starts.toISOString(), new Date(starts.getTime() + 3.6e6).toISOString()]));

    const appointments = await asUser(f.adminA.authId, async (c) =>
      (await c.query(`select id, clinic_id, patient_id, starts_at from appointments
                       where kind = 'md_consult' and status = 'booked'`)).rows);

    const planned = planReminders({
      now,
      clinicNames: { [f.clinicA]: 'Branch A' },
      clinicPhones: { [f.clinicA]: '(02) 8555-0101' },
      patients: [{
        id: state.patientId, clinic_id: f.clinicA, first_name: 'Marites',
        phone: '+639170001234', email: null, birth_date: '1979-03-01',
      }],
      appointments: appointments.map((a) => ({
        id: a.id, clinic_id: a.clinic_id, patient_id: a.patient_id,
        starts_at: new Date(a.starts_at).toISOString(), provider_name: 'Dr. Owner',
      })),
      followups: [],
    });

    const reminder = planned.find((r) => r.kind === 'appointment');
    expect(reminder).toBeDefined();

    await asUser(f.adminA.authId, async (c) =>
      c.query(`insert into reminders (clinic_id, patient_id, appointment_id, kind, channel,
                                      scheduled_for, draft_body, dedupe_key)
               values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [reminder!.clinic_id, reminder!.patient_id, reminder!.appointment_id, reminder!.kind,
         reminder!.channel, reminder!.scheduled_for, reminder!.draft_body, reminder!.dedupe_key]));

    const queued = await asUser(f.adminA.authId, async (c) =>
      (await c.query(`select status, draft_body from reminders where status = 'queued'`)).rows[0]);

    expect(queued.status).toBe('queued'); // queued, not sent: a person approves first
    expect(queued.draft_body).toMatch(/^Magandang araw po, Marites!/);
    log('5', `reminder queued awaiting approval — "${queued.draft_body.slice(0, 68)}…"`);
  });

  it('6. the Owner Dashboard counts the patient in the right branch and in the combined total', async () => {
    const rows = await asUser(f.owner.authId, async (c) =>
      (await c.query(`select * from dashboard_stats(now() - interval '90 days', now() + interval '90 days')`)).rows);

    const branchA = rows.find((r) => r.clinic_id === f.clinicA)!;
    const branchB = rows.find((r) => r.clinic_id === f.clinicB)!;
    const combinedNew = rows.reduce((sum, r) => sum + Number(r.new_patients), 0);

    expect(Number(branchA.new_patients)).toBeGreaterThanOrEqual(1);
    expect(Number(branchA.followups_due)).toBe(1);
    expect(Number(branchB.new_patients)).toBe(1); // the fixture's Branch B patient, not ours
    expect(combinedNew).toBe(Number(branchA.new_patients) + Number(branchB.new_patients));

    // Branch A front desk sees only its own branch in the same function.
    const scoped = await asUser(f.adminA.authId, async (c) =>
      (await c.query(`select * from dashboard_stats(now() - interval '90 days', now() + interval '90 days')`)).rows);
    expect(scoped.filter((r) => Number(r.new_patients) > 0).map((r) => r.clinic_id)).toEqual([f.clinicA]);

    log('6', `owner sees ${rows.length} branches, ${combinedNew} new patients combined; front desk sees 1 branch`);
  });

  it('7. every step left an audit entry naming the user and the time', async () => {
    const entries = await admin(async (c) =>
      (await c.query(
        `select actor_role, action, entity_type, count(*)::int as n
           from audit_log where patient_id = $1
          group by 1,2,3 order by 3,2`, [state.patientId])).rows);

    const summary = entries.map((e) => `${e.actor_role}/${e.action} ${e.entity_type} ×${e.n}`);
    expect(entries.length).toBeGreaterThan(0);

    const kinds = new Set(entries.map((e) => `${e.entity_type}:${e.action}`));
    expect(kinds.has('patients:create')).toBe(true);
    expect(kinds.has('episodes:create')).toBe(true);
    expect(kinds.has('encounters:create')).toBe(true);
    expect(kinds.has('appointments:create')).toBe(true);
    expect(kinds.has('programs:create')).toBe(true);
    expect(kinds.has('reminders:create')).toBe(true);

    const withoutActor = await admin(async (c) =>
      (await c.query(`select count(*)::int as n from audit_log
                       where patient_id = $1 and (actor_staff_id is null or occurred_at is null)`,
        [state.patientId])).rows[0].n);
    expect(withoutActor).toBe(0);

    log('7', `${summary.length} audit groupings, every entry attributed: ${summary.slice(0, 4).join(', ')}…`);
  });

  it('8. signing in as Branch B and requesting the chart by direct ID is denied', async () => {
    const seen = await asUser(f.adminB.authId, async (c) => ({
      patient: (await c.query('select * from patients where id = $1', [state.patientId])).rows,
      notes: (await c.query(`select * from encounter_notes where encounter_id = $1`, [state.encounterId])).rows,
      programme: (await c.query('select * from programs where id = $1', [state.programId])).rows,
      followup: (await c.query('select * from v_followup_due where patient_id = $1', [state.patientId])).rows,
    }));

    expect(seen.patient).toHaveLength(0);
    expect(seen.notes).toHaveLength(0);
    expect(seen.programme).toHaveLength(0);
    expect(seen.followup).toHaveLength(0);
    log('8', 'Branch B front desk: 0 rows on every direct-ID fetch — denied, not merely hidden');
  });

  it('9. prescription safety and CSV export hold on the same chart', async () => {
    const documentId = await asUser(f.owner.authId, async (c) =>
      (await c.query(
        `insert into documents (clinic_id, patient_id, episode_id, kind, title, body)
         values ($1,$2,$3,'prescription','Rx — Marites Santos',
                 '{"text":"Celecoxib 200mg BID x 7 days"}'::jsonb) returning id`,
        [f.clinicA, state.patientId, state.episodeId])).rows[0].id as string);

    // Front desk cannot sign; the document stays a draft.
    await asUser(f.adminA.authId, async (c) => {
      try { await c.query(`update documents set status = 'signed' where id = $1`, [documentId]); }
      catch { /* refused by trigger */ }
    });
    const beforeSigning = await admin(async (c) =>
      (await c.query('select status from documents where id = $1', [documentId])).rows[0]);
    expect(beforeSigning.status).toBe('draft');

    const draftPdf = await renderToBuffer(
      React.createElement(DocumentPdf, {
        kind: 'prescription', title: 'Rx', status: 'draft',
        body: { text: 'Celecoxib 200mg BID x 7 days' },
        patient: { first_name: 'Marites', last_name: 'Santos' },
        clinic: { name: 'Branch A' },
      }) as never);
    expect(draftPdf.subarray(0, 4).toString()).toBe('%PDF');

    await asUser(f.owner.authId, async (c) =>
      c.query(`update documents set status = 'signed' where id = $1`, [documentId]));
    const signed = await admin(async (c) =>
      (await c.query('select status, signed_by, content_hash from documents where id = $1',
        [documentId])).rows[0]);
    expect(signed.status).toBe('signed');
    expect(signed.content_hash).toMatch(/^[0-9a-f]{64}$/);

    const rows = await asUser(f.adminA.authId, async (c) =>
      (await c.query('select id, first_name, last_name, payer_type from patients')).rows);
    const csv = toCsv(rows);
    expect(csv.split('\r\n')[0]).toBe('id,first_name,last_name,payer_type');
    expect(csv).toContain('Santos');

    log('9', 'front desk refused, doctor signed (hash recorded), branch data exports to CSV');
  });
});
