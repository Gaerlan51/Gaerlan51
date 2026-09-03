// Rebuild a local Postgres database from the committed migrations.
//
//   node scripts/db-reset.mjs [--seed]
//
// Same SQL files that ship to Supabase, plus supabase/local/auth_stub.sql,
// which stands in for the hosted `auth` schema. Used by the RLS tests so the
// security model is executed rather than merely asserted.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5433/clinic_test');
const dbName = url.pathname.slice(1);
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';

async function run(connectionString, statements) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    for (const sql of statements) await client.query(sql);
  } finally {
    await client.end();
  }
}

const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
await admin.query(`drop database if exists ${dbName} with (force)`);
await admin.query(`create database ${dbName}`);
await admin.end();

const files = [
  path.join(root, 'supabase/local/auth_stub.sql'),
  ...readdirSync(path.join(root, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(root, 'supabase/migrations', f)),
];
if (process.argv.includes('--seed')) files.push(path.join(root, 'supabase/seed.sql'));

for (const file of files) {
  process.stdout.write(`  applying ${path.relative(root, file)} ... `);
  try {
    await run(url.toString(), [readFileSync(file, 'utf8')]);
    console.log('ok');
  } catch (err) {
    console.log('FAILED');
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
}
console.log(`\nDatabase ${dbName} rebuilt from ${files.length} file(s).`);
