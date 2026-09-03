#!/usr/bin/env node
/**
 * Spec §5. The service-role key bypasses RLS, so its blast radius is the whole
 * database. This fails the build if it is reachable from any code path that
 * serves a signed-in user.
 *
 * Allowed: the scheduled job that generates reminders, and offline scripts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const ALLOWED = [
  path.join('src', 'server', 'jobs'),
  path.join('src', 'lib', 'supabase', 'service.ts'),
  'scripts',
  'tests',
];
const NEEDLES = ['supabase/service', 'SUPABASE_SERVICE_ROLE_KEY', 'createServiceRoleClient'];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

const violations = [];
for (const file of walk(path.join(root, 'src')).concat(walk(path.join(root, 'scripts')))) {
  const rel = path.relative(root, file);
  if (ALLOWED.some((a) => rel === a || rel.startsWith(a + path.sep))) continue;
  const text = readFileSync(file, 'utf8');
  for (const needle of NEEDLES) {
    if (text.includes(needle)) violations.push(`${rel}: references ${needle}`);
  }
}

if (violations.length > 0) {
  console.error('\nRLS bypass reachable from request-serving code (spec §5):\n');
  violations.forEach((v) => console.error('  ' + v));
  console.error('\nMove the work into src/server/jobs/, or use supabaseServer() instead.\n');
  process.exit(1);
}
console.log(`guard:service-role — clean (allowed: ${ALLOWED.join(', ')})`);
