# Phase 1 Build Spec — Claude Prompt

**How to use this file:** hand it to Claude Code as the whole task.

```
Read pt-rehab-clinic/05-claude-build-spec.md and build Phase 1.
Work module by module. Stop and show me the end-to-end flow before Phase 2.
```

This is Part 1 of the master brief with every recommended decision resolved, so the
implementer does not have to guess. Where this file and
[`01-app-dev-brief.md`](01-app-dev-brief.md) differ in detail, **this file wins** —
it is the same requirements with the platform chosen.

---

## 0. Decisions already made — do not re-ask these

The original brief told the builder to ask three questions before starting. They are
answered:

| Question | Answer | Why |
| --- | --- | --- |
| Platform | **Full-code: Next.js + Postgres (Supabase)** | The two non-negotiables — enforced branch scoping and a real audit log — are exactly what low-code platforms handle worst, and both are RA 10173 requirements, not preferences |
| Patient portal | **Later, not Phase 1** | Adds patient authentication and a public attack surface; nothing in Phases 1–3 depends on it |
| Branding / booking page | **No public booking page in Phase 1** | Staff-facing only. Letterhead assets are still needed — see §14 |

Still genuinely open, and listed for the owner in §15 — build against the stated
defaults and flag them rather than blocking.

---

## 1. Stack

- **Next.js (App Router) + TypeScript.** Server Actions for mutations; React Server
  Components for reads.
- **Supabase** — Postgres, Auth, Row Level Security, Storage. Region: Singapore
  (`ap-southeast-1`), the nearest available. Self-hosting Supabase in-country stays
  open as a later move; do not design anything that would prevent it.
- **Database access via `supabase-js` carrying the signed-in user's JWT**, so RLS
  applies to every query. See the service-role rule in §5 — it is the single easiest
  way to destroy the security model.
- **Tailwind CSS + shadcn/ui.** Responsive: desktop at the front desk, tablet/phone
  for therapists and the owner.
- **PDFs: `@react-pdf/renderer`.** Pure JS, no headless Chromium, so it works on
  serverless without a custom binary.
- **Migrations: Supabase CLI SQL migrations, committed to the repo.** No schema changes
  made by hand in the dashboard.
- **Tests: Vitest + `@testing-library/react`,** plus the RLS integration tests in §13
  which are mandatory, not optional.

Do not add a state-management library, an ORM layer over `supabase-js`, or a component
library beyond shadcn/ui without asking first.

---

## 2. Non-negotiables

These are compliance and patient-safety requirements. If a design choice conflicts with
one of them, the design choice loses.

1. **Branch isolation is enforced in the database**, via RLS — never by hiding UI
   elements. A Branch A user requesting a Branch B record by direct ID gets a denial,
   not an empty screen.
2. **Every read, write, print, export, and send of patient data is audited** with the
   actor, timestamp, and target.
3. **No prescription, referral, or therapy program is ever auto-finalized.** Everything
   destined for a patient chart is a draft until a clinician signs it. Unsigned document
   PDFs are watermarked (§9).
4. **All data is exportable to CSV and PDF** from day one. Assume migration to a
   certified EMR eventually; do not lock the data in.
5. **The service-role key never runs in a request handler serving a signed-in user.**

---

## 3. Roles

| Role | Own branch | Other branches | Billing | Clinical notes |
| --- | --- | --- | --- | --- |
| `owner` | Full read/write | **Read-only** | Yes | Yes |
| `admin` (front desk) | Read/write scheduling, intake, billing, reminders | None | Yes | Metadata only — diagnosis and program title, not full note bodies |
| `therapist` | Read assigned patients; write session notes and progress | None | **No** | Yes, for assigned patients |

The owner's cross-branch access is `SELECT` only. There is no UI path for the owner to
edit another branch's records — that is deliberate, to prevent two people editing the
same chart from different branches.

"Assigned patients" for a therapist means the patient has an appointment or an active
episode assigned to that therapist at that therapist's clinic.

---

## 4. Data model

Every core table carries `clinic_id uuid not null references clinics(id)`. All tables
carry `id uuid primary key default gen_random_uuid()`, `created_at`, `updated_at`.

```
clinics              name, address, phone, letterhead_url, is_active

staff                auth_user_id (→ auth.users), clinic_id, role
                     ('owner'|'admin'|'therapist'), full_name, discipline
                     ('PT'|'OT'|'Speech'|'Psych'|'PO'|'MD'|null),
                     prc_license_no, is_active

rooms                clinic_id, name, is_active

patients             clinic_id, first_name, last_name, birth_date, sex,
                     phone, email, address, payer_type
                     ('philhealth'|'hmo'|'cash'|'referral'),
                     hmo_name, philhealth_no, referring_physician_id,
                     consent_signed_at, notes

referring_physicians clinic_id, full_name, clinic_name, specialty, phone, email

episodes             clinic_id, patient_id, diagnosis, icd10_code,
                     case_type ('msk'|'neuro'|'pedia'|'other'),
                     followup_rule ('every_6_sessions'|'monthly'),
                     started_on, ended_on, primary_therapist_id, status
                     ('active'|'completed'|'discontinued')

encounters           clinic_id, patient_id, episode_id, kind
                     ('md_consult'|'therapy_session'|'acupuncture'),
                     provider_id, occurred_at,
                     soap_subjective, soap_objective, soap_assessment, soap_plan,
                     status ('draft'|'final'), finalized_at, finalized_by

appointments         clinic_id, patient_id, episode_id, provider_id, room_id,
                     starts_at, ends_at, kind, status
                     ('booked'|'completed'|'cancelled'|'no_show'),
                     encounter_id, during tstzrange GENERATED

program_templates    clinic_id (nullable = network-wide), discipline, name,
                     body jsonb (ordered exercise/goal items), is_active

programs             clinic_id, patient_id, episode_id, template_id, discipline,
                     body jsonb, status ('draft'|'signed'),
                     signed_by, signed_at, pdf_path

documents            clinic_id, patient_id, episode_id, kind
                     ('referral_back'|'referral_out'|'prescription'),
                     body jsonb, status ('draft'|'signed'|'voided'),
                     signed_by, signed_at, content_hash, pdf_path

reminders            clinic_id, patient_id, appointment_id, kind
                     ('appointment'|'birthday'|'followup_due'),
                     channel ('sms'|'email'), scheduled_for, draft_body,
                     status ('queued'|'approved'|'sent'|'failed'|'skipped'),
                     sent_at, provider_message_id, error

audit_log            occurred_at, actor_staff_id, actor_role, clinic_id,
                     action ('view'|'create'|'update'|'delete'|'print'
                            |'export'|'send'|'sign'),
                     entity_type, entity_id, patient_id, summary,
                     ip, user_agent, before jsonb, after jsonb
```

Phase 2 adds `charges`, `claims`, `payments`. Phase 3 adds `leads`,
`education_resources`. Do not create them yet, but do not design anything that would
make them awkward to add.

### Double-booking prevention

Enforce it in Postgres, not in application code:

```sql
create extension if not exists btree_gist;

alter table appointments add constraint appointments_no_provider_overlap
  exclude using gist (provider_id with =, during with &&)
  where (status in ('booked','completed'));

alter table appointments add constraint appointments_no_room_overlap
  exclude using gist (room_id with =, during with &&)
  where (status in ('booked','completed') and room_id is not null);
```

The UI catches the resulting error and shows a readable conflict message. An
application-layer check alone is not acceptable — two front-desk staff booking
simultaneously will slip through it.

---

## 5. Row Level Security

Enable RLS on **every** table. No table is left open.

Define two `stable security definer` helper functions that read the caller's row from
`staff` via `auth.uid()`:

```sql
create function current_clinic_id() returns uuid ...
create function current_role_name() returns text ...
```

Policy shape for every clinic-scoped table:

- **SELECT** — `clinic_id = current_clinic_id() or current_role_name() = 'owner'`
- **INSERT / UPDATE / DELETE** — `clinic_id = current_clinic_id()`
  (the owner's cross-branch access is read-only, so no exception here)

Additional restrictions layered on top:

- `therapist` cannot select from Phase 2 billing tables at all.
- `admin` selects `encounters` and `programs` metadata but not SOAP body columns —
  implement with a view exposing non-body columns, and deny direct table select to the
  admin role.
- `audit_log` — insert allowed for any authenticated user; select limited to `owner`
  and to `admin` for their own clinic; **update and delete revoked from everyone**,
  including the table owner role. It is append-only.

### The service-role rule

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely. It is permitted **only** in the
scheduled reminder job (§10) and in migrations. It must never be used in a route
handler or Server Action running on behalf of a signed-in user — doing so silently
turns off every protection in this section. Add a lint rule or a CI grep that fails the
build if the service-role client is imported outside the allowed files.

---

## 6. Audit logging

- **Writes** — a Postgres trigger on each core table appends to `audit_log` with the
  `before`/`after` row as jsonb.
- **Reads** — Postgres cannot trigger on `SELECT`. So every chart view goes through a
  single server-side accessor (`getPatientChart(patientId)`) that writes a `view` audit
  entry before returning. Do not let components query patient charts directly; enforce
  it with a lint rule on direct table access outside the data layer.
- **Print / export / send / sign** — logged explicitly at the action.

Ship a simple audit viewer for the `owner` role: filter by patient, staff member, date
range, action. Without a viewer, the log is compliance theater.

---

## 7. Patient records (EMR-lite)

- Demographics, contact, payer type, referring physician, consent-signed date.
- Chart view: episodes, encounters in reverse chronology, programs, documents,
  appointments, and the follow-up status banner from §8.
- **SOAP consultation notes** with `draft` → `final`. Finalizing locks the four SOAP
  fields; corrections are appended as an addendum encounter that references the
  original, never an in-place edit. This is what makes the record defensible.
- **Program builder:** pick a template by discipline, customize per patient, export
  PDF. Templates are seeded per §15 — do not invent clinical content; if no templates
  are supplied, ship the builder with an empty library and say so.

---

## 8. The follow-up rule (precise)

Each episode carries `followup_rule`, defaulted from `case_type` and overridable by the
doctor:

| `case_type` | Default rule |
| --- | --- |
| `msk`, `neuro` | `every_6_sessions` |
| `pedia` | `monthly` |
| `other` | `every_6_sessions` |

Let `anchor` = the `occurred_at` of the most recent finalized `md_consult` encounter
for the episode, falling back to `episodes.started_on` when there is none.

- **`every_6_sessions`** — due when the count of `therapy_session` encounters with
  `occurred_at > anchor` reaches **6**.
- **`monthly`** — due when `now() - anchor >= interval '1 month'`.

Expose this as a database view `v_followup_due` (patient, episode, clinic, rule,
sessions since anchor, days since anchor, `is_due`). The chart banner, the "due for MD
follow-up" worklist, the reminder generator, and the Owner Dashboard all read that one
view — the rule is defined once, not reimplemented four times.

---

## 9. Referral and prescription documents

Three kinds: referral-back-to-physician, referral-to-other-facility, and drug
prescription. All render to PDF on clinic letterhead.

**The safety mechanism, which is not optional:**

- Documents are created `status = 'draft'`.
- A draft PDF is watermarked diagonally across every page:
  **`DRAFT — NOT VALID FOR DISPENSING`**.
- Only a staff member whose role is `owner` (the doctor) can transition a document to
  `signed`. Therapists and admins cannot, and the transition is enforced by an RLS
  policy — not only by hiding the button.
- Signing records `signed_by`, `signed_at`, and a SHA-256 `content_hash` of the body.
  If the body is later edited, the hash no longer matches and the document reverts to
  `draft`, with the watermark returning.
- The signed prescription PDF shows the doctor's name and PRC license number.
- Nothing in the system may transition a document to `signed` automatically, on any
  trigger, ever.

---

## 10. Reminders

A scheduled job (Supabase `pg_cron`, hourly) populates `reminders`:

| Kind | When | Body |
| --- | --- | --- |
| `appointment` | 24–48h before a `booked` appointment | Date, time, branch, provider |
| `birthday` | On the patient's birthday, 8am local | Warm greeting, no clinical content |
| `followup_due` | When `v_followup_due.is_due` first turns true | Invitation to book an MD follow-up |

Drafts default to English with natural Filipino courtesy phrasing ("Magandang araw
po"); offer a Tagalog/Taglish variant. Tone and content follow
[`02-ops-assistant-system-prompt.md`](02-ops-assistant-system-prompt.md).

**Staff review before send.** The queue screen shows drafts; a staff member approves
individually or in a reviewed batch, and sending is one explicit action that writes a
`send` audit entry. Nothing sends without a human approving it — including birthdays.

Send via a provider adapter behind one interface (`sendSms`, `sendEmail`) so the
provider can be swapped. Default: Semaphore for SMS, Resend for email. Timezone
throughout: `Asia/Manila`. Store timestamps as `timestamptz`; never store naive local
times.

Never put diagnosis, clinical findings, or another patient's information in a reminder
body.

---

## 11. Owner Dashboard

Read-only, per branch and combined, over a selectable period (this week / this month /
custom):

- Consultations completed
- Active therapy patients
- New patients
- Follow-ups due (from `v_followup_due`)
- No-show rate
- Outstanding claims value and cash collected vs. pending — **Phase 2 fields; show them
  as "Available in Phase 2" placeholders now, not fabricated zeros**

Every figure links through to the underlying list, read-only. No edit affordance
appears anywhere on another branch's data.

Charts are optional in Phase 1; correct numbers matter more than visualization.

---

## 12. Export

- Per-table CSV export, branch-scoped, for `owner` and `admin`.
- Full patient chart as PDF.
- A whole-database export script the owner can run, producing CSVs plus chart PDFs.

Every export writes an `export` audit entry naming the actor and the row count.

---

## 13. Testing — required before you call Phase 1 done

**RLS tests are the most important tests in this codebase.** Write integration tests
using real Supabase clients signed in as three seeded users — Branch A admin, Branch B
admin, Branch A therapist — asserting:

1. Branch A admin selecting a Branch B patient by ID returns **zero rows**.
2. Branch A admin updating a Branch B patient **fails**.
3. Owner selecting across both branches **succeeds**; owner updating a non-home-branch
   record **fails**.
4. Therapist selecting billing tables **fails** (once Phase 2 exists).
5. Therapist and admin transitioning a document to `signed` **fails**.
6. Any user updating or deleting an `audit_log` row **fails**.
7. Overlapping appointments for the same provider, and for the same room, are
   **rejected by the database**.

Plus unit tests for the §8 follow-up rule covering: 5 sessions (not due), 6 sessions
(due), 6 sessions where one preceded the anchor consult (not due), pedia at 29 days
(not due) and 31 days (due).

---

## 14. Environment and assets

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY     # cron + migrations only — see §5
SEMAPHORE_API_KEY
RESEND_API_KEY
APP_TIMEZONE=Asia/Manila
```

Needed from the owner before documents can print correctly: clinic letterhead or logo,
the 5 branch names / addresses / phone numbers, and the doctor's full name and PRC
license number. Build against placeholders and flag them clearly — do not block on
these.

---

## 15. Ask the owner — but keep building

Proceed with the stated default and surface the question; none of these should stall
the build:

- **Program template library** — the PT/OT/Speech/Psych/PO templates to seed. *Default:
  ship the builder with an empty library.* Clinical content is not the builder's to
  invent.
- **Therapist roster and room inventory per branch** — conflict checking needs both.
  *Default: seed two therapists and two rooms per branch as test data.*
- **SMS sender ID** — Semaphore registration takes lead time. *Default: build against
  the sandbox sender.*
- **Backup cadence and restore ownership** — a backup nobody has restored is not a
  backup. *Default: Supabase daily backups plus a weekly CSV export to the owner's
  storage.*
- **Cross-border transfer** — hosting in Singapore is lawful under RA 10173 but the
  clinic remains accountable for the transfer. Flag it for the owner's DPO; do not
  attempt to resolve it in code.

The app supports RA 10173 compliance; it does not constitute it. NPC registration of
the data processing system, appointing a Data Protection Officer, patient consent
forms, and breach-notification procedures are organizational obligations the owner must
handle separately.

---

## 16. Out of scope for Phase 1

Do not build these, even if they seem easy: patient portal or any patient login,
billing and claims (Phase 2), lead tracker and education library (Phase 3), payment
gateway integration, public booking page, native mobile apps, any claim of "real-time"
Philhealth or HMO status.

---

## 17. Done means

Phase 1 is complete when one patient can be walked end to end, and not before:

1. Front desk registers a patient with payer type and referring physician.
2. Doctor writes a SOAP note and generates a therapy program from a template,
   customized, exported as PDF.
3. Front desk books therapy sessions; the **database** refuses to double-book the
   therapist or room.
4. After the 6th session (or one month for a pedia case), the patient appears in the
   "due for MD follow-up" list automatically.
5. Tomorrow's appointment reminder appears in the queue with a drafted message awaiting
   staff approval.
6. The Owner Dashboard counts that patient in the right branch and in the combined
   totals, read-only.
7. Every step above left an audit entry naming the user and timestamp.
8. Signing in as Branch B and requesting that patient's record by direct ID is
   **denied**.
9. All RLS and follow-up-rule tests in §13 pass.

Show that walkthrough before starting Phase 2.
