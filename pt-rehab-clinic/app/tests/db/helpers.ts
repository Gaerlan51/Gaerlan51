import pg from 'pg';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5433/clinic_test';

/** Superuser connection: fixture setup only. Never used to make assertions. */
export async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Run queries the way the app does: as the `authenticated` role with a JWT
 * subject, so every policy in 0004_rls.sql applies. Connecting as a superuser
 * would bypass RLS and make these tests prove nothing.
 */
export async function asUser<T>(authUserId: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query('set role authenticated');
    await client.query('select set_config($1, $2, false)', ['request.jwt.claim.sub', authUserId]);
    return await fn(client);
  } finally {
    await client.end();
  }
}

export type Fixtures = Awaited<ReturnType<typeof seedFixtures>>;

/** Two branches, four staff, two patients, one active MSK episode. */
export async function seedFixtures() {
  return admin(async (c) => {
    await c.query(`
      truncate audit_log, reminders, documents, program_body, programs,
        program_templates, appointments, encounter_notes, encounters,
        episodes, patients, referring_physicians, rooms, staff, clinics
        restart identity cascade;
      delete from auth.users;
    `);

    const ids: Record<string, string> = {};
    const uuid = async (label: string) => {
      const { rows } = await c.query<{ id: string }>('select gen_random_uuid() as id');
      ids[label] = rows[0].id;
      return rows[0].id;
    };

    const clinicA = await uuid('clinicA');
    const clinicB = await uuid('clinicB');
    await c.query(`insert into clinics (id, name) values ($1,'Branch A'), ($2,'Branch B')`, [clinicA, clinicB]);

    const mkStaff = async (
      label: string,
      clinic: string,
      role: 'owner' | 'admin' | 'therapist',
      name: string,
      discipline: string | null = null,
    ) => {
      const authId = await uuid(`${label}Auth`);
      const staffId = await uuid(label);
      await c.query('insert into auth.users (id, email) values ($1,$2)', [authId, `${label}@example.test`]);
      await c.query(
        `insert into staff (id, auth_user_id, clinic_id, role, full_name, discipline, prc_license_no)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [staffId, authId, clinic, role, name, discipline, role === 'owner' ? 'PRC-000000' : null],
      );
      return { authId, staffId };
    };

    const owner = await mkStaff('owner', clinicA, 'owner', 'Dr. Owner', 'MD');
    const adminA = await mkStaff('adminA', clinicA, 'admin', 'Front Desk A');
    const therapistA = await mkStaff('therapistA', clinicA, 'therapist', 'Therapist A', 'PT');
    const adminB = await mkStaff('adminB', clinicB, 'admin', 'Front Desk B');
    const therapistB = await mkStaff('therapistB', clinicB, 'therapist', 'Therapist B', 'PT');

    const roomA = await uuid('roomA');
    const roomB = await uuid('roomB');
    await c.query(`insert into rooms (id, clinic_id, name) values ($1,$2,'Gym A'), ($3,$4,'Gym B')`,
      [roomA, clinicA, roomB, clinicB]);

    const patientA = await uuid('patientA');
    const patientB = await uuid('patientB');
    await c.query(
      `insert into patients (id, clinic_id, first_name, last_name, birth_date, payer_type, phone)
       values ($1,$2,'Ana','Reyes','1980-05-14','philhealth','+639170000001'),
              ($3,$4,'Ben','Cruz','1975-02-02','hmo','+639170000002')`,
      [patientA, clinicA, patientB, clinicB],
    );

    const episodeA = await uuid('episodeA');
    await c.query(
      `insert into episodes (id, clinic_id, patient_id, diagnosis, case_type, followup_rule,
                             started_on, primary_therapist_id)
       values ($1,$2,$3,'Lumbar radiculopathy','msk','every_6_sessions', current_date - 30, $4)`,
      [episodeA, clinicA, patientA, therapistA.staffId],
    );

    return {
      clinicA, clinicB, roomA, roomB, patientA, patientB, episodeA,
      owner, adminA, therapistA, adminB, therapistB,
    };
  });
}
