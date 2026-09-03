/**
 * Spec §13 — the most important tests in this codebase.
 *
 * Every query here runs as the `authenticated` role with a real JWT subject,
 * so what is being tested is the database's own enforcement, not the UI's.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { asUser, admin, seedFixtures, type Fixtures } from './helpers';

let f: Fixtures;
beforeAll(async () => { f = await seedFixtures(); });

describe('§13.1–2 branch isolation for front desk', () => {
  it('Branch A admin selecting a Branch B patient by ID returns zero rows', async () => {
    const rows = await asUser(f.adminA.authId, async (c) =>
      (await c.query('select id from patients where id = $1', [f.patientB])).rows);
    expect(rows).toHaveLength(0);
  });

  it('Branch A admin cannot list any Branch B patient', async () => {
    const rows = await asUser(f.adminA.authId, async (c) =>
      (await c.query('select id, clinic_id from patients')).rows);
    expect(rows).toHaveLength(1);
    expect(rows[0].clinic_id).toBe(f.clinicA);
  });

  it('Branch A admin updating a Branch B patient changes nothing', async () => {
    const res = await asUser(f.adminA.authId, async (c) =>
      c.query(`update patients set last_name = 'Tampered' where id = $1`, [f.patientB]));
    expect(res.rowCount).toBe(0);

    const after = await admin(async (c) =>
      (await c.query('select last_name from patients where id = $1', [f.patientB])).rows[0]);
    expect(after.last_name).toBe('Cruz');
  });
});

describe('§13.3 owner cross-branch access is read-only', () => {
  it('owner selects patients across both branches', async () => {
    const rows = await asUser(f.owner.authId, async (c) =>
      (await c.query('select id from patients order by last_name')).rows);
    expect(rows).toHaveLength(2);
  });

  it('owner updating a non-home-branch patient changes nothing', async () => {
    const res = await asUser(f.owner.authId, async (c) =>
      c.query(`update patients set last_name = 'OwnerEdit' where id = $1`, [f.patientB]));
    expect(res.rowCount).toBe(0);

    const after = await admin(async (c) =>
      (await c.query('select last_name from patients where id = $1', [f.patientB])).rows[0]);
    expect(after.last_name).toBe('Cruz');
  });

  it('owner can still edit their own branch', async () => {
    const res = await asUser(f.owner.authId, async (c) =>
      c.query(`update patients set notes = 'seen today' where id = $1`, [f.patientA]));
    expect(res.rowCount).toBe(1);
  });
});

describe('§13.4 clinical confidentiality between roles', () => {
  it('front desk cannot read SOAP bodies, but can see that the encounter exists', async () => {
    const encounterId = await admin(async (c) => {
      const { rows } = await c.query(
        `insert into encounters (clinic_id, patient_id, episode_id, kind, provider_id, occurred_at)
         values ($1,$2,$3,'md_consult',$4, now()) returning id`,
        [f.clinicA, f.patientA, f.episodeA, f.owner.staffId]);
      await c.query(
        `insert into encounter_notes (encounter_id, clinic_id, soap_subjective)
         values ($1,$2,'confidential')`, [rows[0].id, f.clinicA]);
      return rows[0].id as string;
    });

    const seen = await asUser(f.adminA.authId, async (c) => ({
      meta: (await c.query('select id from encounters where id = $1', [encounterId])).rows,
      notes: (await c.query('select * from encounter_notes where encounter_id = $1', [encounterId])).rows,
    }));

    expect(seen.meta).toHaveLength(1);
    expect(seen.notes).toHaveLength(0);
  });

  it.todo('therapist selecting billing tables fails — Phase 2, tables do not exist yet');
});

describe('§13.5 only the owner may sign', () => {
  let documentId: string;
  beforeAll(async () => {
    documentId = await admin(async (c) => {
      const { rows } = await c.query(
        `insert into documents (clinic_id, patient_id, kind, title, body)
         values ($1,$2,'prescription','Rx', '{"text":"Paracetamol 500mg"}'::jsonb) returning id`,
        [f.clinicA, f.patientA]);
      return rows[0].id as string;
    });
  });

  /**
   * The two roles are denied by different layers, so assert the property that
   * matters — the document does not become signed — rather than the mechanism.
   * Front desk passes the RLS USING clause and is stopped by the trigger with
   * an explicit error; a therapist is filtered out by RLS first, so the update
   * matches no row and the trigger never runs. Both are denials.
   */
  const expectCannotSign = async (authId: string) => {
    await asUser(authId, async (c) => {
      try {
        await c.query(`update documents set status = 'signed' where id = $1`, [documentId]);
      } catch {
        /* an explicit refusal is one valid form of denial */
      }
    });
    const row = await admin(async (c) =>
      (await c.query('select status, signed_by from documents where id = $1', [documentId])).rows[0]);
    expect(row.status).toBe('draft');
    expect(row.signed_by).toBeNull();
  };

  it('front desk cannot sign a prescription', async () => {
    await expectCannotSign(f.adminA.authId);
  });

  it('front desk signing is refused explicitly by the trigger', async () => {
    await expect(asUser(f.adminA.authId, async (c) =>
      c.query(`update documents set status = 'signed' where id = $1`, [documentId])),
    ).rejects.toThrow(/only the owner\/doctor role may sign/i);
  });

  it('a therapist cannot sign a prescription', async () => {
    await expectCannotSign(f.therapistA.authId);
  });

  it('the owner can sign, and signing records who and when plus a content hash', async () => {
    await asUser(f.owner.authId, async (c) =>
      c.query(`update documents set status = 'signed' where id = $1`, [documentId]));

    const row = await admin(async (c) =>
      (await c.query('select status, signed_by, signed_at, content_hash from documents where id = $1',
        [documentId])).rows[0]);
    expect(row.status).toBe('signed');
    expect(row.signed_by).toBe(f.owner.staffId);
    expect(row.signed_at).not.toBeNull();
    expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('editing a signed document reverts it to draft', async () => {
    await asUser(f.owner.authId, async (c) =>
      c.query(`update documents set body = '{"text":"Paracetamol 1g"}'::jsonb where id = $1`, [documentId]));

    const row = await admin(async (c) =>
      (await c.query('select status, signed_by, content_hash from documents where id = $1',
        [documentId])).rows[0]);
    expect(row.status).toBe('draft');
    expect(row.signed_by).toBeNull();
    expect(row.content_hash).toBeNull();
  });

  it('a document cannot be born signed', async () => {
    const row = await asUser(f.owner.authId, async (c) =>
      (await c.query(
        `insert into documents (clinic_id, patient_id, kind, title, body, status)
         values ($1,$2,'referral_out','Referral','{}'::jsonb,'signed') returning status`,
        [f.clinicA, f.patientA])).rows[0]);
    expect(row.status).toBe('draft');
  });
});

describe('§13.6 the audit log is append-only', () => {
  it('records writes automatically', async () => {
    const before = await admin(async (c) =>
      Number((await c.query('select count(*) from audit_log')).rows[0].count));
    await asUser(f.adminA.authId, async (c) =>
      c.query(`update patients set address = 'Quezon City' where id = $1`, [f.patientA]));
    const after = await admin(async (c) =>
      (await c.query(`select actor_role, action, entity_type from audit_log order by id desc limit 1`)).rows[0]);
    const count = await admin(async (c) =>
      Number((await c.query('select count(*) from audit_log')).rows[0].count));

    expect(count).toBeGreaterThan(before);
    expect(after).toMatchObject({ actor_role: 'admin', action: 'update', entity_type: 'patients' });
  });

  it('labels a signature as sign, not update', async () => {
    const row = await admin(async (c) =>
      (await c.query(`select action from audit_log
                       where entity_type = 'documents' and action = 'sign' limit 1`)).rows[0]);
    expect(row?.action).toBe('sign');
  });

  it('no user can update an audit entry', async () => {
    await expect(asUser(f.owner.authId, async (c) =>
      c.query(`update audit_log set actor_role = 'nobody' where id = (select min(id) from audit_log)`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it('no user can delete an audit entry', async () => {
    await expect(asUser(f.owner.authId, async (c) =>
      c.query('delete from audit_log where id = (select min(id) from audit_log)')),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('§13.7 double-booking is rejected by the database', () => {
  const at = (h: number) => `2026-03-02T${String(h).padStart(2, '0')}:00:00+08`;

  it('rejects an overlapping booking for the same provider', async () => {
    await asUser(f.adminA.authId, async (c) =>
      c.query(`insert into appointments (clinic_id, patient_id, episode_id, provider_id, room_id,
                                         starts_at, ends_at, kind)
               values ($1,$2,$3,$4,$5,$6,$7,'therapy_session')`,
        [f.clinicA, f.patientA, f.episodeA, f.therapistA.staffId, f.roomA, at(9), at(10)]));

    await expect(asUser(f.adminA.authId, async (c) =>
      c.query(`insert into appointments (clinic_id, patient_id, provider_id, starts_at, ends_at, kind)
               values ($1,$2,$3,$4,$5,'therapy_session')`,
        [f.clinicA, f.patientA, f.therapistA.staffId, at(9), at(10)])),
    ).rejects.toThrow(/appointments_no_provider_overlap/);
  });

  it('rejects an overlapping booking for the same room', async () => {
    const other = await admin(async (c) =>
      (await c.query(
        `insert into staff (auth_user_id, clinic_id, role, full_name, discipline)
         values (gen_random_uuid(), $1, 'therapist', 'Therapist A2', 'OT') returning id`,
        [f.clinicA])).rows[0].id as string);

    await expect(asUser(f.adminA.authId, async (c) =>
      c.query(`insert into appointments (clinic_id, patient_id, provider_id, room_id,
                                         starts_at, ends_at, kind)
               values ($1,$2,$3,$4,$5,$6,'therapy_session')`,
        [f.clinicA, f.patientA, other, f.roomA, at(9), at(10)])),
    ).rejects.toThrow(/appointments_no_room_overlap/);
  });

  it('allows the same slot once the clashing appointment is cancelled', async () => {
    await asUser(f.adminA.authId, async (c) =>
      c.query(`update appointments set status = 'cancelled'
                where provider_id = $1 and starts_at = $2`, [f.therapistA.staffId, at(9)]));

    const res = await asUser(f.adminA.authId, async (c) =>
      c.query(`insert into appointments (clinic_id, patient_id, provider_id, room_id,
                                         starts_at, ends_at, kind)
               values ($1,$2,$3,$4,$5,$6,'therapy_session')`,
        [f.clinicA, f.patientA, f.therapistA.staffId, f.roomA, at(9), at(10)]));
    expect(res.rowCount).toBe(1);
  });
});

describe('§17.8 cross-branch fetch by direct ID is denied', () => {
  it('Branch B front desk cannot reach a Branch A chart by ID', async () => {
    const seen = await asUser(f.adminB.authId, async (c) => ({
      patient: (await c.query('select id from patients where id = $1', [f.patientA])).rows,
      episodes: (await c.query('select id from episodes where patient_id = $1', [f.patientA])).rows,
      encounters: (await c.query('select id from encounters where patient_id = $1', [f.patientA])).rows,
      appointments: (await c.query('select id from appointments where patient_id = $1', [f.patientA])).rows,
      documents: (await c.query('select id from documents where patient_id = $1', [f.patientA])).rows,
    }));
    expect(seen.patient).toHaveLength(0);
    expect(seen.episodes).toHaveLength(0);
    expect(seen.encounters).toHaveLength(0);
    expect(seen.appointments).toHaveLength(0);
    expect(seen.documents).toHaveLength(0);
  });
});

describe('finalized notes are locked (spec §7)', () => {
  it('SOAP fields cannot be edited after finalization; addenda are the path', async () => {
    const encounterId = await asUser(f.owner.authId, async (c) => {
      const { rows } = await c.query(
        `insert into encounters (clinic_id, patient_id, episode_id, kind, provider_id)
         values ($1,$2,$3,'md_consult',$4) returning id`,
        [f.clinicA, f.patientA, f.episodeA, f.owner.staffId]);
      await c.query(
        `insert into encounter_notes (encounter_id, clinic_id, soap_subjective, soap_plan)
         values ($1,$2,'Back pain','PT 2x/week')`, [rows[0].id, f.clinicA]);
      await c.query(`update encounters set status = 'final' where id = $1`, [rows[0].id]);
      return rows[0].id as string;
    });

    await expect(asUser(f.owner.authId, async (c) =>
      c.query(`update encounter_notes set soap_plan = 'changed' where encounter_id = $1`, [encounterId])),
    ).rejects.toThrow(/locked once the encounter is finalized/i);

    await expect(asUser(f.owner.authId, async (c) =>
      c.query(`update encounters set status = 'draft' where id = $1`, [encounterId])),
    ).rejects.toThrow(/cannot be reopened/i);

    const addendum = await asUser(f.owner.authId, async (c) =>
      c.query(`insert into encounters (clinic_id, patient_id, episode_id, kind, provider_id, addendum_of)
               values ($1,$2,$3,'md_consult',$4,$5)`,
        [f.clinicA, f.patientA, f.episodeA, f.owner.staffId, encounterId]));
    expect(addendum.rowCount).toBe(1);
  });
});
