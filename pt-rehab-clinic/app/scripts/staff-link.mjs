#!/usr/bin/env node
/**
 * Give staff records a login.
 *
 *   DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/staff-link.mjs [--dry-run]
 *
 * For every staff row that has an email but no auth_user_id, this creates a
 * Supabase Auth account and writes its id back to the row. Until that link
 * exists nobody can sign in — current_staff_id() resolves through it, so an
 * unlinked account has no branch, no role, and no access to anything.
 *
 * --dry-run  list what would happen and touch nothing. Needs only DATABASE_URL.
 *
 * Passwords are generated here and printed once. Distribute them in person or
 * over a channel the patient data itself would be safe on, and have staff
 * change them at first sign-in. Do not paste them into chat or email.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const dryRun = process.argv.includes('--dry-run');
const DATABASE_URL = process.env.DATABASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DATABASE_URL) {
  console.error('Set DATABASE_URL.');
  process.exit(1);
}
if (!dryRun && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --dry-run.');
  process.exit(1);
}

/** 18 bytes of base64url: comfortably beyond guessing, still typable once. */
const generatePassword = () => randomBytes(18).toString('base64url');

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? undefined : { rejectUnauthorized: false },
});
await client.connect();

try {
  const { rows: pending } = await client.query(`
    select s.id, s.full_name, s.email, s.role, c.name as clinic_name
      from staff s
      join clinics c on c.id = s.clinic_id
     where s.email is not null
       and s.auth_user_id is null
       and s.is_active
     order by c.name, s.role, s.full_name;
  `);

  const { rows: [counts] } = await client.query(`
    select count(*) filter (where auth_user_id is not null) as linked,
           count(*) filter (where email is null)            as no_email
      from staff where is_active;
  `);

  if (pending.length === 0) {
    console.log(`Nothing to do: ${counts.linked} staff already linked, ` +
                `${counts.no_email} have no email set.`);
    process.exit(0);
  }

  console.log(`${pending.length} staff record(s) need an account:\n`);
  for (const s of pending) {
    console.log(`  ${s.email.padEnd(28)} ${s.role.padEnd(10)} ${s.clinic_name} — ${s.full_name}`);
  }

  if (dryRun) {
    const placeholders = pending.filter((s) => /@example\.(ph|com|test)$/.test(s.email));
    console.log(`\n--dry-run: nothing was created.`);
    if (placeholders.length > 0) {
      console.log(
        `\n${placeholders.length} of these still use placeholder addresses from the seed.\n` +
        'Replace them with real work emails first — an account created against\n' +
        '@example.ph can never receive a password reset.',
      );
      process.exit(1);
    }
    process.exit(0);
  }

  const created = [];
  for (const staff of pending) {
    const password = generatePassword();
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: staff.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: staff.full_name, staff_id: staff.id },
      }),
    });

    const payload = await res.json().catch(() => ({}));

    // An address that already has an account is not a failure: link to it.
    let authUserId = payload?.id;
    if (!res.ok) {
      const alreadyExists = res.status === 422 || /already/i.test(payload?.msg ?? payload?.message ?? '');
      if (!alreadyExists) {
        console.error(`  ${staff.email}: ${res.status} ${payload?.msg ?? payload?.message ?? 'failed'}`);
        continue;
      }
      const lookup = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(staff.email)}`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
      );
      const found = await lookup.json().catch(() => ({}));
      authUserId = found?.users?.find((u) => u.email?.toLowerCase() === staff.email.toLowerCase())?.id;
      if (!authUserId) {
        console.error(`  ${staff.email}: account exists but could not be found to link.`);
        continue;
      }
      console.log(`  ${staff.email}: existing account linked (password unchanged)`);
      await client.query('update staff set auth_user_id = $1 where id = $2', [authUserId, staff.id]);
      continue;
    }

    await client.query('update staff set auth_user_id = $1 where id = $2', [authUserId, staff.id]);
    created.push({ email: staff.email, password, role: staff.role, clinic: staff.clinic_name });
  }

  if (created.length > 0) {
    console.log('\nAccounts created — this is the only time these are shown:\n');
    for (const c of created) {
      console.log(`  ${c.email.padEnd(28)} ${c.password}   (${c.role}, ${c.clinic})`);
    }
    console.log(
      '\nHand these over in person and have each person change theirs at first sign-in.\n' +
      'Anyone holding one of these can open patient records for that branch.',
    );
  }
} finally {
  await client.end();
}
