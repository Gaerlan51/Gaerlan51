# Clinic Management — Phase 1

Staff-facing clinic management for a five-branch physical medicine and rehabilitation
practice. Built to [`../05-claude-build-spec.md`](../05-claude-build-spec.md); section
references below (§4, §9, §17…) point into that spec.

Phase 1 only: patient records, scheduling, reminders, referral and prescription
documents, and the Owner Dashboard. Billing and claims are Phase 2; the lead tracker
and education library are Phase 3. There is no patient portal and no public booking
page — the clinical app is staff-only by decision, not by omission.

**Added beyond the spec:** a public corporate site (`/`, `/services`, `/branches`,
`/about`, `/contact`). The spec excluded a public *booking* page, not a public site;
these pages are static, read nothing from the database, and are the one part of the
app a patient can reach.

## Running it

```bash
npm install
cp .env.example .env.local     # fill in Supabase + provider keys

npm run dev                    # needs a Supabase project
npm run verify                 # guard + typecheck + all 69 tests
```

The tests need a local Postgres 16, not a Supabase project:

```bash
initdb -D .pgdata && pg_ctl -D .pgdata -o "-p 5433" start
TEST_DATABASE_URL=postgres://postgres@localhost:5433/clinic_test \
  node scripts/db-reset.mjs --seed
TEST_DATABASE_URL=postgres://postgres@localhost:5433/clinic_test npm test
```

`supabase/local/auth_stub.sql` stands in for the hosted `auth` schema so the same
migrations run in both places. It is not a migration and never ships.

## How the non-negotiables are enforced

Each of these is enforced in the database, and each has a test that proves it. The
recurring principle: **if the UI is the only thing stopping it, it isn't stopped.**

| Requirement | Mechanism | Test |
| --- | --- | --- |
| Branch isolation (§2.1) | RLS on every table; `SELECT` allows own branch or owner, writes are own-branch only | `tests/db/rls.test.ts` §13.1–3 |
| Owner is read-only cross-branch (§3) | No owner exception in any write policy | §13.3 |
| Front desk cannot read SOAP bodies (§3) | Clinical text lives in `encounter_notes` / `program_body`, denied to `admin` | §13.4 |
| No double-booking (§4) | GiST exclusion constraints on provider and room time ranges | §13.7 |
| Only the doctor signs (§9) | RLS `WITH CHECK` **and** a trigger; documents are born as drafts | §13.5 |
| A signature cannot outlive its text (§9) | Signing hashes the body; editing a signed body reverts it to draft | §13.5 |
| Finalized notes are locked (§7) | Trigger refuses SOAP edits and reopening; addenda instead | `rls.test.ts` |
| Audit log is append-only (§2.2) | No `UPDATE`/`DELETE` policy, and the privilege is revoked | §13.6 |
| The follow-up rule is defined once (§8) | `v_followup_due`; four consumers, one definition | `tests/db/followup.test.ts` |
| Service-role key stays out of request paths (§5) | `npm run guard:service-role`, wired into `npm run verify` | run it against a deliberate violation |

### Three decisions worth knowing

**Clinical text is split into companion tables.** `encounters` holds metadata,
`encounter_notes` holds SOAP; `programs` holds the title, `program_body` the exercises.
"Front desk sees that a consult happened, not what it said" is then a schema fact
rather than a view that must be remembered.

**Reads are audited in the data layer, writes by trigger.** Postgres has no `SELECT`
trigger, so chart reads go through `getPatientChart()` in `src/server/audit.ts`, which
logs before returning. Querying `patients` directly from a page would silently skip
that — hence the single accessor.

**An RLS denial on `UPDATE` is a no-op, not an error.** Zero rows match the policy and
Postgres reports success. `assertAffected()` in `src/domain/conflicts.ts` turns
"nothing changed" into a refusal, so the UI can never report a save that did not happen.

## Layout

```
src/domain/     Pure business logic — no Supabase, no React. Directly unit-tested.
src/server/     Server Actions and queries. Every write goes through here.
src/server/jobs/  The only request-free code allowed the service-role key.
src/app/(marketing)/  Public corporate site. Static; touches no patient data.
src/app/(app)/  Authenticated clinic app behind a staff session.
src/app/login/  Sign-in, outside both groups so it renders full-bleed.
src/pdf/        @react-pdf/renderer documents, including the draft watermark.
supabase/migrations/  The schema. Committed SQL; no dashboard edits.
```

## Design system

One token set in `globals.css`, exposed to Tailwind as `bg-surface`, `text-muted`,
`border-line` and so on. Light is the default because the front desk works under bright
clinic lighting; dark follows the operating system, so a therapist checking a chart on
a phone at night is not flashbanged between patients. Because both themes come from the
same tokens, no component carries a second palette.

- **Type and colour** — a system font stack (swap in a webfont via `next/font` by
  changing `--font-sans`); teal brand, amber for drafts, rose for refusals.
- **Icons** — hand-rolled inline SVG in `src/components/icons.tsx`. `currentColor`
  throughout, so they theme for free and add no dependency.
- **Accessibility** — one `h1` per page, a skip link, `:focus-visible` rings, ARIA
  on every disclosure, `aria-live` on the sign-in error, and
  `prefers-reduced-motion` honoured. Verified in a real browser, not assumed.
- **Print** — `.no-print` strips chrome so a chart or letter prints clean.

## Images

Every image on the public site is a **slot** in `src/lib/images.ts`, carrying its alt
text, aspect ratio, and a one-line brief describing the photograph that belongs there.
`<Figure slot="…">` renders the photograph once one exists and draws brand artwork
until then — same box, same ratio either way, so dropping real photography in never
reflows the page.

No photographs ship in this repo: the sandbox this was built in blocks outbound access
to image hosts, so none could be downloaded. The artwork in the slots today is
hand-drawn SVG, not a grey box, and the site is presentable as it stands.

**To fill the slots with licensed stock:**

```bash
PEXELS_API_KEY=... npm run fetch:stock          # all slots
PEXELS_API_KEY=... npm run fetch:stock -- hero  # one slot
```

The script searches each slot's brief, picks the result whose aspect ratio best matches
the slot, downloads to `public/images/`, and records the photographer credit in
`src/lib/images.generated.json`. It has never been executed — the slot parsing was
verified here, the network path was not. Check the first result before trusting the
rest, and remember that a search result is not an editorial decision.

**To use the clinic's own photography**, drop files in `public/images/` and set `src`
on the slot directly. Prefer this: real rooms and real staff (with their written
permission) beat stock models of strangers.

Two rules no script can enforce:

1. **Never a real patient.** A patient photograph is health information under RA 10173,
   and consent to treatment is not consent to appear in marketing.
2. **Don't let stock imply otherwise.** Stock models are strangers; a caption must not
   suggest they are your patients or your results.

## What is verified, and what is not

Verified by `npm run verify` against a real Postgres with RLS active:

- 69 tests pass — 22 RLS, 12 follow-up rule, 9 end-to-end walkthrough, 26 domain.
- `tests/db/walkthrough.test.ts` walks §17's nine points as one patient: registration →
  SOAP note → programme PDF → 6 booked sessions → automatic follow-up flag → queued
  reminder → dashboard rollup → audit trail → cross-branch denial.
- `npm run build` compiles all 19 routes; `tsc --noEmit` is clean.
- The public pages were rendered in headless Chromium at 1440px and 390px, light and
  dark: every page has exactly one `h1`, none scrolls sideways on mobile, and
  `/dashboard` returns a 307 to `/login` for an anonymous request.

**Not verified here:** anything requiring a real Supabase project. The public site,
sign-in page and route protection were checked in a real browser, but Supabase Auth
sign-in and every authenticated screen behind it have been compiled and typechecked
without ever being clicked through — there were no credentials to sign in with. First
task on a real project: run the §17 walkthrough by hand in the browser.

**Also outstanding**, from §15 — the owner supplies these, and the app flags rather than
invents them: programme templates (the library ships empty), real branch names and
letterhead, the doctor's PRC licence number, therapist roster and room inventory, and
the Semaphore sender ID.

## Deploying

1. Create the Supabase project (Singapore, `ap-southeast-1`).
2. Apply `supabase/migrations/*.sql` in order, then `supabase/seed.sql`.
3. Create Auth users for staff, then set `staff.auth_user_id` to match. Nobody can sign
   in until this is done.
4. Set the environment variables from `.env.example`.
5. Schedule `POST /api/cron/reminders` hourly with the `CRON_SECRET` bearer token.

RA 10173 note: this app supports compliance but does not constitute it. NPC
registration, a Data Protection Officer, patient consent forms and breach-notification
procedures are the clinic's to put in place, and hosting in Singapore is a cross-border
transfer the clinic remains accountable for.
