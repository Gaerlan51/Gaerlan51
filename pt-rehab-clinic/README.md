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

## How to use this pack

1. **Read [`03-feasibility-notes.md`](03-feasibility-notes.md) first.** It flags where
   "real-time" and "automatic" aren't realistic for an individual clinic in the
   Philippines today, and says what to build instead. Skipping it means asking a
   builder for something it will either fake or fail at.
2. **Answer [`04-open-questions.md`](04-open-questions.md).** Platform choice,
   patient-portal scope, and branding are all decisions the brief deliberately
   refuses to assume.
3. **Paste Part 1** into your app builder. Each part is in a single fenced block so
   it copies cleanly.
4. **Paste Part 2** into Claude as a Project system prompt. Part 2 is useful
   *immediately*, before any software exists — it works as a stopgap for front-desk
   drafting and scheduling logic while Phase 1 is still being built.

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
