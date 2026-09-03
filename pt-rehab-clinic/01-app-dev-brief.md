# Part 1 — Application Development Brief

Paste the block below into an AI app-builder (Claude Code, Lovable, Bolt.new, Replit
Agent, Cursor) to generate the software phase by phase.

Before you paste it, settle [`04-open-questions.md`](04-open-questions.md) — the brief
ends by telling the builder to ask those questions, and you'll save a round trip by
having the answers ready.

---

```text
You are building a clinic management system for a physical medicine and 
rehabilitation (PT/OT/Speech/Psych) practice operating 5 independent 
clinic branches under one owner-doctor, plus an owner-level rollup dashboard.

BUSINESS MODEL
- Services: physiatry consultations, medical acupuncture, PT, OT, Speech 
  therapy, Psych services, and prosthetics/orthotics (PO) programs.
- Patient types: Philhealth members, HMO members, walk-ins, physician referrals.
- Follow-up cadence: after every 6 therapy sessions for musculoskeletal and 
  neurologic cases; every 1 month for pediatric rehab cases.
- Each of the 5 clinics operates independently day-to-day (own front desk, 
  own patient list, own schedule). The owner needs a single combined 
  dashboard that aggregates data across all 5 without merging their 
  daily operations.

ARCHITECTURE
- Multi-branch, single database, branch-scoped by a `clinic_id` field on 
  every core record (patients, appointments, encounters, claims, payments).
- Each branch's staff only see/edit their own branch's records by default.
- Owner role has a read-only cross-branch view (the "Owner Dashboard") — 
  see REPORTING section below.
- Build as a responsive web app (works on desktop at front desk, tablet/
  phone for therapists and the owner).

USER ROLES
1. Owner/Doctor — full access to own branch, read-only rollup across all 5.
2. Branch Admin/Front Desk — scheduling, patient intake, billing entry, 
   reminders, for their branch only.
3. Therapist (PT/OT/Speech/Psych/PO) — views assigned patients, logs 
   session notes and progress, cannot see billing.
4. (Optional, later phase) Patient portal — view own upcoming appointments, 
   download exercise materials, see outstanding balance.

CORE MODULES — BUILD IN THIS ORDER (MVP first)

Phase 1 — MVP (build first, get this working before anything else):
1. Patient records (EMR-lite)
   - Demographics, contact info, referring physician, diagnosis, 
     payer type (Philhealth / HMO name / Cash / Referral).
   - Consultation notes (SOAP-style: Subjective, Objective, Assessment, Plan).
   - Program builder: generate a PT, OT, Speech, Psych, or PO program 
     (template library the doctor can customize per patient) and export/
     print as PDF.
2. Scheduling
   - Calendar per branch: consultations + therapy sessions.
   - Session counter per patient (auto-flags "due for MD follow-up" after 
     6 sessions for MSK/neuro cases, or after 1 month for pedia cases).
   - Simple conflict checking (no double-booking a therapist or room).
3. Reminders (automation)
   - Auto-generate reminder queue: upcoming appointment (24-48h before), 
     birthday greeting, "you're due for follow-up" trigger.
   - Draft messages for SMS/email — see INTEGRATIONS for sending.
4. Referral & prescription documents
   - Generate printable/PDF: referral-back-to-physician letter, 
     referral-to-other-facility letter, drug prescription (doctor 
     e-signs or the doctor prints and wet-signs — do NOT let the system 
     auto-finalize a prescription without doctor review/approval).
5. Owner Dashboard (cross-branch)
   - Per branch and combined totals: # consultations this week/month, 
     # active therapy patients, # new patients, # follow-ups due, 
     outstanding claims value, cash collected vs. pending.
   - This is READ-ONLY roll-up; it does not let the owner edit another 
     branch's records directly (avoids conflicts/accidental edits).

Phase 2 — Billing & Claims Tracker:
6. Payment & claims tracker (see feasibility note below — this is a 
   TRACKER, not a live bank/Philhealth integration)
   - Log each visit's charge, payer type, and status: 
     Submitted → Pending → Approved → Paid → Denied.
   - Aging report: flag claims pending > 30/60/90 days.
   - Cash and GCash payments logged at point of service (see 
     INTEGRATIONS for actual GCash payment collection).

Phase 3 — Marketing / Growth:
7. Lead & inquiry tracker — log inbound inquiries (call, FB, walk-in) 
   with source, so you can see which channel brings patients, and a 
   simple "convert lead → new patient" button.
8. Education content library — searchable/taggable list of exercise 
   videos (YouTube links) and handouts (PDFs) by diagnosis/condition, 
   so front desk or therapist can quickly attach the right ones to a 
   patient record and send them.

INTEGRATIONS (build these as connectors, not custom-coded from scratch)
- SMS/Email reminders: use a provider API (e.g., Semaphore or Movider 
  for PH SMS; Gmail API or SendGrid for email). Do not attempt to build 
  an SMS gateway from scratch.
- GCash payments: do NOT attempt direct GCash bank integration. Use a 
  licensed payment gateway that supports GCash as a payment method 
  (e.g., PayMongo, Xendit, DragonPay) — the app just needs to generate 
  a payment link/QR and receive a webhook confirming payment.
- Philhealth / HMO claims status: there is no public real-time API for 
  this. Build the claims tracker (Phase 2, item 6) as a manually-updated 
  status field with aging alerts — do not promise "real-time" status to 
  staff or patients.

DATA PRIVACY & COMPLIANCE (non-negotiable, build in from day 1, not later)
- This system stores sensitive personal health information — subject to 
  the Philippine Data Privacy Act (RA 10173).
- Role-based access control (a therapist should not see another branch's 
  billing; front desk should not see full clinical notes unless needed).
- Audit log: who viewed/edited/printed each patient record and when.
- Data backup/export capability (assume the owner will eventually want 
  to migrate to a proper certified EMR — do not lock data in a proprietary 
  format that can't be exported to CSV/PDF).

WHAT TO ASK ME (the app builder should ask, not assume) BEFORE STARTING:
- Confirm which no-code/low-code platform this will run on and its 
  constraints (e.g., if using Bubble/Softr/Glide, some of the above 
  needs to be simplified — flag anything not supported).
- Confirm whether patient portal (Phase 1 optional item) is in scope now 
  or later.
- Confirm branding basics (clinic names, logo, color scheme) if this 
  needs a public-facing booking page.

Build Phase 1 completely and working before starting Phase 2. Show me 
the patient record + scheduling + reminders flow end-to-end first.
```

---

## Acceptance check for Phase 1

Phase 1 is done when a single patient can be walked end to end without leaving the
app:

1. Front desk registers a new patient with payer type and referring physician.
2. Doctor writes a SOAP consultation note and generates a therapy program from a
   template, customized for that patient, exported as PDF.
3. Front desk books therapy sessions on the branch calendar; the app refuses to
   double-book the therapist or room.
4. After the 6th logged session (or one month for a pedia case), the patient appears
   in the "due for MD follow-up" list automatically.
5. A reminder for tomorrow's appointment appears in the reminder queue with a drafted
   message, ready to send.
6. The Owner Dashboard shows that patient counted in the right branch's totals, and in
   the combined totals — read-only.
7. Every one of those steps left an audit-log entry naming the user and the timestamp.

If any of those seven can't be demonstrated, Phase 1 is not finished and Phase 2 does
not start.

## The design risk to watch

The brief's `clinic_id` scoping is the load-bearing decision. Enforce it at the data
layer (row-level security, or an equivalent server-side filter applied before any
query runs), not by hiding buttons in the UI. Ask the builder to prove it: sign in as
Branch A front desk and attempt to open a Branch B patient by direct URL/record ID.
The correct result is a denial, not a blank screen.
