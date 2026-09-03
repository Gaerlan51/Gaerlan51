# PT Rehab Clinic Network — Master Build Prompts

Prompt pack for a physical medicine and rehabilitation practice (PT / OT / Speech /
Psych / prosthetics-orthotics, plus physiatry consults and medical acupuncture)
running **5 independent clinic branches under one owner-doctor**, with an
owner-level cross-branch rollup dashboard.

## What's in here

| File | What it is | Where you paste it |
| --- | --- | --- |
| [`01-app-dev-brief.md`](01-app-dev-brief.md) | Part 1 — the full application development brief, phased MVP-first | An AI app builder: Claude Code, Lovable, Bolt.new, Replit Agent, Cursor, etc. |
| [`02-ops-assistant-system-prompt.md`](02-ops-assistant-system-prompt.md) | Part 2 — system prompt for the clinic's day-to-day AI ops assistant | Claude (Project custom instructions), or the assistant slot inside the app once it exists |
| [`03-feasibility-notes.md`](03-feasibility-notes.md) | Reality checks on the four places where "automatic" isn't buildable yet | Read before building — it changes what you ask for |
| [`04-open-questions.md`](04-open-questions.md) | The decisions that must be answered before Phase 1 starts | Answer these first; they're blocking |
| [`05-claude-build-spec.md`](05-claude-build-spec.md) | **The build spec.** Part 1 with every platform decision resolved — schema, RLS policies, follow-up rule, prescription safety, acceptance tests | Claude Code, as the whole task |

## How to use this pack

**To build the software**, hand [`05-claude-build-spec.md`](05-claude-build-spec.md) to
Claude Code:

```
Read pt-rehab-clinic/05-claude-build-spec.md and build Phase 1.
Work module by module. Stop and show me the end-to-end flow before Phase 2.
```

That spec resolves the three questions the original brief left open — full-code on
Next.js + Postgres with row-level security, patient portal deferred, no public booking
page in Phase 1 — and specifies the schema, RLS policies, follow-up rule, and
acceptance tests concretely. Files 01 and 04 remain as the record of the original ask
and of why each decision went the way it did.

**To run the clinic day to day**, paste
[`02-ops-assistant-system-prompt.md`](02-ops-assistant-system-prompt.md) into a Claude
Project. It's useful *immediately*, before any software exists — a stopgap for
front-desk drafting and scheduling logic while Phase 1 is being built.

**Before either**, read [`03-feasibility-notes.md`](03-feasibility-notes.md). It flags
where "real-time" and "automatic" aren't realistic for an individual clinic in the
Philippines today, and says what to build instead.

## Build order (non-negotiable)

Phase 1 must be complete and working end-to-end — patient record → schedule →
reminder — before Phase 2 begins.

```
Phase 1 (MVP)      Patient records (EMR-lite) · Scheduling · Reminders
                   · Referral & prescription documents · Owner Dashboard
Phase 2            Billing & claims tracker (manual status + aging alerts)
Phase 3            Lead/inquiry tracker · Patient education content library
```

## Two rules that outrank everything else

- **Branch scoping from day one.** Every core record carries a `clinic_id`. Staff at
  Branch A must never see or edit Branch B's data. Retrofitting access control after
  the fact is the single most painful mistake available here.
- **Data Privacy Act (RA 10173) compliance is built in, not added later.** Role-based
  access, an audit log of who viewed/edited/printed each record, and CSV/PDF export
  so the data is never locked in.

## Clinical safety line

Nothing the AI produces for a patient's chart is final. Prescriptions, referral
letters, and therapy programs are **drafts pending clinician review and signature** —
in the app and in the assistant prompt alike. The system must not auto-finalize a
prescription.
