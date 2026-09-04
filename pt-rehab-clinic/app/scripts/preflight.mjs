#!/usr/bin/env node
/**
 * Check a deployment before letting staff — or patients — near it.
 *
 *   node scripts/preflight.mjs https://your-app.vercel.app
 *
 * Every check here is something that would be a real incident if it failed:
 * an anonymous request reaching a chart, an unauthenticated export, a cron
 * endpoint anyone can trigger, a clinical page a search engine can index.
 *
 * Exits non-zero if any REQUIRED check fails. Warnings do not fail the run —
 * headers set in vercel.json are absent under `next start`, so a local check
 * legitimately reports them missing.
 */
const base = (process.argv[2] ?? '').replace(/\/$/, '');
if (!base) {
  console.error('Usage: node scripts/preflight.mjs https://your-app.vercel.app');
  process.exit(1);
}

const results = [];
const record = (ok, required, label, detail) =>
  results.push({ ok, required, label, detail });

async function probe(path, options = {}) {
  try {
    const res = await fetch(base + path, { redirect: 'manual', ...options });
    return { status: res.status, headers: res.headers, location: res.headers.get('location') };
  } catch (err) {
    return { status: 0, error: err.message, headers: new Headers() };
  }
}

// --- public site is reachable -------------------------------------------
const home = await probe('/');
record(home.status === 200, true, 'Public site responds', `GET / → ${home.status}`);

const login = await probe('/login');
record(login.status === 200, true, 'Sign-in page responds', `GET /login → ${login.status}`);

// --- nothing clinical is reachable anonymously --------------------------
for (const path of ['/dashboard', '/patients', '/schedule', '/followups', '/reminders', '/audit']) {
  const res = await probe(path);
  const redirected = res.status >= 300 && res.status < 400 && /\/login/.test(res.location ?? '');
  record(redirected, true, `Anonymous ${path} is refused`,
    redirected ? `${res.status} → ${res.location}` : `expected a redirect to /login, got ${res.status}`);
}

// An export endpoint answering 200 without a session would be a data breach.
// Assert the refusal explicitly: "not 200" would also be satisfied by an
// unreachable server, which must never read as a passing security check.
const REFUSALS = [301, 302, 303, 307, 308, 401, 403, 404];
const exportRes = await probe('/api/export/patients');
record(REFUSALS.includes(exportRes.status), true, 'Anonymous CSV export is refused',
  exportRes.status === 0
    ? `unreachable (${exportRes.error})`
    : `GET /api/export/patients → ${exportRes.status}`);

// --- the cron endpoint is not open --------------------------------------
const cronOpen = await probe('/api/cron/reminders');
record(cronOpen.status === 401, true, 'Cron endpoint requires its bearer token',
  `GET /api/cron/reminders → ${cronOpen.status}`);

const cronWrong = await probe('/api/cron/reminders', {
  headers: { Authorization: 'Bearer definitely-not-the-secret' },
});
record(cronWrong.status === 401, true, 'Cron endpoint rejects a wrong token',
  `→ ${cronWrong.status}`);

// --- headers (warnings: vercel.json applies these in production only) ----
const headerChecks = [
  ['x-frame-options', 'X-Frame-Options'],
  ['x-content-type-options', 'X-Content-Type-Options'],
  ['referrer-policy', 'Referrer-Policy'],
];
for (const [key, label] of headerChecks) {
  const value = home.headers.get(key);
  record(Boolean(value), false, `${label} is set`, value ?? 'absent');
}

const dash = await probe('/dashboard');
const robots = dash.headers.get('x-robots-tag');
record(Boolean(robots && /noindex/.test(robots)), false,
  'Clinical routes are marked noindex', robots ?? 'absent');

const cache = dash.headers.get('cache-control');
record(Boolean(cache && /no-store/.test(cache)), false,
  'Clinical routes are marked no-store', cache ?? 'absent');

// --- report --------------------------------------------------------------
let failed = 0;
console.log(`\nPreflight — ${base}\n`);
for (const r of results) {
  const mark = r.ok ? '  ok  ' : r.required ? ' FAIL ' : ' warn ';
  if (!r.ok && r.required) failed += 1;
  console.log(`${mark} ${r.label.padEnd(42)} ${r.detail}`);
}

const warnings = results.filter((r) => !r.ok && !r.required).length;
console.log(
  `\n${results.length - failed - warnings} passed, ${failed} failed, ${warnings} warning(s).`,
);
if (warnings > 0) {
  console.log('Warnings are expected against `next start`: vercel.json sets those headers.');
}
if (failed > 0) {
  console.log('\nDo not let staff in until the failures above are fixed.');
  process.exit(1);
}
