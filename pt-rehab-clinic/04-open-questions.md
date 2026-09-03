# Open Questions — Answer Before Phase 1 Starts

Part 1 ends by instructing the builder to ask these rather than assume. Answering them
up front saves a round trip; each one changes what gets built.

## 1. Which platform? (blocking)

Everything downstream depends on this — whether audit logs, branch-scoped permissions,
and PDF export are native, plugin-dependent, or impossible.

| Option | Fits when | Watch out for |
| --- | --- | --- |
| **Full-code** (e.g. Next.js + Postgres with row-level security, or Supabase/Django) | You want every item in the brief, including audit logs and true server-side branch scoping | Needs someone to own hosting, backups, and updates long-term |
| **Bubble** | You want visual editing and can pay for plugins | Audit logging and e-signature need workarounds; permission rules get complex fast at 5 branches |
| **Glide / Softr** | Fastest to a usable schedule + patient list | Weakest on audit logs and fine-grained roles — likely disqualifying for health records |
| **Airtable + Softr front end** | Quickest interim tracker while a real build proceeds | Not a long-term EMR; plan the exit |

**Recommendation:** full-code on Postgres with row-level security. The brief's two
non-negotiables — enforced `clinic_id` scoping and a real audit log — are exactly what
low-code platforms handle worst, and both are compliance requirements rather than
nice-to-haves. If speed matters more than completeness right now, run an Airtable
stopgap for scheduling *only* (no clinical notes) alongside the real build.

## 2. Patient portal — now or later?

Listed as optional in Phase 1. It adds patient authentication, a public surface, and a
much larger privacy blast radius.

**Recommendation:** later. Ship Phase 1 for staff, prove the branch scoping holds under
real use, then add the portal. Nothing in Phases 1–3 depends on it.

## 3. Branding basics

Needed only if there's a public-facing booking page. To supply: the 5 clinic branch
names and addresses, the network name, a logo file, and a color scheme.

**Also needed regardless of a booking page**, because they appear on printed
documents: the clinic letterhead, the doctor's name and PRC license number for
prescriptions and referral letters, and each branch's contact number for reminders.

## 4. Decisions the brief implies but doesn't state

Worth settling before the builder guesses:

- **SMS provider** — Semaphore or Movider. Sender-ID registration takes time; start it
  early. Confirm the per-message cost against expected reminder volume.
- **Payment gateway** — PayMongo, Xendit, or DragonPay. See
  [`03-feasibility-notes.md`](03-feasibility-notes.md) §2; business registration is
  usually the long pole.
- **Who keys in claim status, and when** — name a person per branch and a fixed weekly
  slot. An un-owned tracker produces an aging report nobody can trust.
- **Program template library** — the PT/OT/Speech/Psych/PO templates the doctor wants
  seeded on day one. The builder can't invent clinically sound ones; supply the
  starting set.
- **Data hosting location and backup cadence** — where the database lives, who holds
  the backups, and how often they're tested by actually restoring one.
- **Therapist roster and room inventory per branch** — the scheduler's conflict
  checking needs both before it can prevent a double-booking.
