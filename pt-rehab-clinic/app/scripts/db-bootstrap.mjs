#!/usr/bin/env node
/**
 * Apply the schema to a database — a real Supabase project, or a local one.
 *
 *   DATABASE_URL=postgres://... node scripts/db-bootstrap.mjs [--seed] [--local]
 *
 * Safe to re-run: each migration is recorded in `schema_migrations` and skipped
 * next time. Unlike scripts/db-reset.mjs, which drops the database outright,
 * this never destroys anything and is the one to point at a live project.
 *
 *   --seed    also apply supabase/seed.sql (branches, rooms, staff placeholders)
 *   --local   allow creating the local `auth` stub; refused against a database
 *             that already has a real Supabase auth schema
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';

const root = path.resolve(import.meta.dirname, '..');
const url = process.env.DATABASE_URL ?? process.argv.find((a) => a.startsWith('postgres://'));
const seed = process.argv.includes('--seed');
const local = process.argv.includes('--local');

if (!url) {
  console.error('Set DATABASE_URL (Supabase → Project Settings → Database → Connection string).');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false },
});
await client.connect();

const digest = (sql) => createHash('sha256').update(sql).digest('hex').slice(0, 16);

try {
  await client.query(`
    create table if not exists schema_migrations (
      filename    text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    );
  `);

  const { rows: authRows } = await client.query(`
    select exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'auth' and p.proname = 'uid'
    ) as present;
  `);

  if (!authRows[0].present) {
    if (!local) {
      console.error(
        '\nThis database has no auth.uid(), so it is not a Supabase project.\n' +
        'Point DATABASE_URL at your Supabase project, or pass --local to create\n' +
        'the development stand-in (never do that against a real project).\n',
      );
      process.exit(1);
    }
    const stub = readFileSync(path.join(root, 'supabase/local/auth_stub.sql'), 'utf8');
    await client.query(stub);
    console.log('  applied  supabase/local/auth_stub.sql  (local development only)');
  }

  const files = readdirSync(path.join(root, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql')).sort();
  if (seed) files.push('../seed.sql');

  let applied = 0;
  for (const file of files) {
    const full = path.join(root, 'supabase/migrations', file);
    const sql = readFileSync(full, 'utf8');
    const checksum = digest(sql);
    const name = path.basename(file);

    const { rows } = await client.query(
      'select checksum from schema_migrations where filename = $1', [name],
    );

    if (rows.length > 0) {
      if (rows[0].checksum !== checksum) {
        console.error(
          `\n${name} has changed since it was applied.\n` +
          'Migrations are immutable once they run: add a new migration instead of editing this one.\n',
        );
        process.exit(1);
      }
      console.log(`  skipped  ${name}`);
      continue;
    }

    // Each migration runs in its own transaction, so a failure leaves the
    // database on the last good migration rather than half-way through one.
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query(
        'insert into schema_migrations (filename, checksum) values ($1, $2)', [name, checksum],
      );
      await client.query('commit');
      console.log(`  applied  ${name}`);
      applied += 1;
    } catch (err) {
      await client.query('rollback');
      console.error(`\n${name} failed: ${err.message}\n`);
      process.exit(1);
    }
  }

  console.log(
    `\n${applied} migration(s) applied, ${files.length - applied} already present.` +
    (seed ? '' : '\nRun again with --seed to load branches, rooms and staff placeholders.'),
  );
  console.log('Next: create Auth users, then `npm run staff:link` to connect them to staff rows.');
} finally {
  await client.end();
}
