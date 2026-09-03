/**
 * Spec §8 — the follow-up rule, tested at its boundaries.
 *
 * These run against v_followup_due, the single definition the chart banner,
 * worklist, reminder generator and dashboard all read.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { admin, asUser, seedFixtures, type Fixtures } from './helpers';

let f: Fixtures;
beforeEach(async () => { f = await seedFixtures(); });

/** Record `n` therapy sessions, `offsetDays` before now. */
async function logSessions(episodeId: string, clinicId: string, patientId: string,
                           providerId: string, n: number, offsetDays = 0) {
  await admin(async (c) => {
    for (let i = 0; i < n; i++) {
      await c.query(
        `insert into encounters (clinic_id, patient_id, episode_id, kind, provider_id, occurred_at, status)
         values ($1,$2,$3,'therapy_session',$4,
                 now() - make_interval(days => $5) + make_interval(mins => $6), 'final')`,
        [clinicId, patientId, episodeId, providerId, offsetDays, i]);
    }
  });
}

async function mdConsult(episodeId: string, clinicId: string, patientId: string,
                         providerId: string, daysAgo: number, status: 'draft' | 'final' = 'final') {
  return admin(async (c) =>
    (await c.query(
      `insert into encounters (clinic_id, patient_id, episode_id, kind, provider_id, occurred_at, status)
       values ($1,$2,$3,'md_consult',$4, now() - make_interval(days => $5), $6) returning id`,
      [clinicId, patientId, episodeId, providerId, daysAgo, status])).rows[0].id as string);
}

const due = async (f: Fixtures) =>
  asUser(f.owner.authId, async (c) =>
    (await c.query('select * from v_followup_due where episode_id = $1', [f.episodeA])).rows[0]);

describe('every_6_sessions (MSK / neuro)', () => {
  it('5 sessions is not due', async () => {
    await logSessions(f.episodeA, f.clinicA, f.patientA, f.therapistA.staffId, 5);
    const row = await due(f);
    expect(row.sessions_since_anchor).toBe(5);
    expect(row.is_due).toBe(false);
  });

  it('6 sessions is due', async () => {
    await logSessions(f.episodeA, f.clinicA, f.patientA, f.therapistA.staffId, 6);
    const row = await due(f);
    expect(row.sessions_since_anchor).toBe(6);
    expect(row.is_due).toBe(true);
  });

  it('sessions before the anchor consult do not count', async () => {
    // Six sessions, then the doctor reviews: the counter restarts from the
    // consult, so the patient is not immediately due again.
    await logSessions(f.episodeA, f.clinicA, f.patientA, f.therapistA.staffId, 6, 10);
    await mdConsult(f.episodeA, f.clinicA, f.patientA, f.owner.staffId, 5);
    const row = await due(f);
    expect(row.sessions_since_anchor).toBe(0);
    expect(row.is_due).toBe(false);
  });

  it('counts only sessions after the most recent consult', async () => {
    await logSessions(f.episodeA, f.clinicA, f.patientA, f.therapistA.staffId, 6, 10);
    await mdConsult(f.episodeA, f.clinicA, f.patientA, f.owner.staffId, 5);
    await logSessions(f.episodeA, f.clinicA, f.patientA, f.therapistA.staffId, 6, 4);
    const row = await due(f);
    expect(row.sessions_since_anchor).toBe(6);
    expect(row.is_due).toBe(true);
  });

  it('a draft consult is not an anchor — only a finalized one resets the count', async () => {
    await logSessions(f.episodeA, f.clinicA, f.patientA, f.therapistA.staffId, 6, 10);
    await mdConsult(f.episodeA, f.clinicA, f.patientA, f.owner.staffId, 5, 'draft');
    const row = await due(f);
    expect(row.sessions_since_anchor).toBe(6);
    expect(row.is_due).toBe(true);
  });
});

describe('monthly (pedia)', () => {
  beforeEach(async () => {
    await admin(async (c) =>
      c.query(`update episodes set case_type = 'pedia', followup_rule = 'monthly',
                                   started_on = current_date where id = $1`, [f.episodeA]));
  });

  it('29 days since the anchor is not due', async () => {
    await mdConsult(f.episodeA, f.clinicA, f.patientA, f.owner.staffId, 29);
    const row = await due(f);
    expect(row.days_since_anchor).toBe(29);
    expect(row.is_due).toBe(false);
  });

  it('31 days since the anchor is due', async () => {
    await mdConsult(f.episodeA, f.clinicA, f.patientA, f.owner.staffId, 31);
    const row = await due(f);
    expect(row.days_since_anchor).toBe(31);
    expect(row.is_due).toBe(true);
  });

  it('session count does not make a pedia case due', async () => {
    await mdConsult(f.episodeA, f.clinicA, f.patientA, f.owner.staffId, 3);
    await logSessions(f.episodeA, f.clinicA, f.patientA, f.therapistA.staffId, 10, 2);
    const row = await due(f);
    expect(row.sessions_since_anchor).toBe(10);
    expect(row.is_due).toBe(false);
  });
});

describe('scope and lifecycle', () => {
  it('falls back to the episode start date when there has been no consult', async () => {
    const row = await due(f);
    expect(row.days_since_anchor).toBe(30); // fixture starts the episode 30 days ago
    expect(row.sessions_since_anchor).toBe(0);
  });

  it('drops out of the worklist once the episode is closed', async () => {
    await logSessions(f.episodeA, f.clinicA, f.patientA, f.therapistA.staffId, 6);
    expect((await due(f)).is_due).toBe(true);
    await admin(async (c) =>
      c.query(`update episodes set status = 'completed' where id = $1`, [f.episodeA]));
    expect(await due(f)).toBeUndefined();
  });

  it('is branch-scoped: Branch B front desk sees no Branch A follow-ups', async () => {
    await logSessions(f.episodeA, f.clinicA, f.patientA, f.therapistA.staffId, 6);
    const rows = await asUser(f.adminB.authId, async (c) =>
      (await c.query('select * from v_followup_due')).rows);
    expect(rows).toHaveLength(0);
  });

  it('the owner sees follow-ups across branches', async () => {
    await logSessions(f.episodeA, f.clinicA, f.patientA, f.therapistA.staffId, 6);
    const rows = await asUser(f.owner.authId, async (c) =>
      (await c.query('select * from v_followup_due where is_due')).rows);
    expect(rows).toHaveLength(1);
  });
});
