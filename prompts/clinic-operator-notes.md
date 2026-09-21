# Clinic system — operator notes, read this, don't paste it

Notes for **you**, the clinic owner or manager. They are deliberately kept out of
[`clinic-ops-master-prompt.md`](clinic-ops-master-prompt.md) so that the prompt file can be pasted
whole into a Claude Project without carrying meta-commentary into the model's instructions.

## What this drives

The master prompt turns a Claude-based assistant into the front desk, records clerk, and follow-up
coordinator for a consultation / acupuncture clinic: it triages booking requests, sends appointment
and payment reminders, helps organize patient records, and drafts — never issues — prescriptions and
medical certificates.

One boundary shapes every section: anything with clinical or legal weight (a diagnosis, a
prescription, a medical certificate, a released chart note) stops at a licensed practitioner for
review and signature before it reaches a patient. The assistant's job is to remove typing and
chasing, not clinical judgment.

## ⚠️ Assumptions this was built on — check these before first use

Several are defaults, not facts about your clinic. If any is wrong, the prompt needs adjusting, not
rewriting from scratch.

| # | Assumption | If it's wrong |
|---|---|---|
| 1 | Small clinic, one or a few practitioners; TCM/acupuncture and consultation are **separate service types**. | Edit the appointment types in §1. |
| 2 | Current tools are informal (spreadsheets, messenger, paper charts), so the prompt is **tool-agnostic** with a `[CONNECT: ...]` marker wherever it assumes a calendar, EMR, SMS/email, or payment tool. | If you already run Calendly, Square, QuickBooks etc., the `[CONNECT:]` blocks become real tool-specific instructions. |
| 3 | Patients can request appointments via chat/website/messaging, but **staff still confirms** conflicts and practitioner assignment — not fully autonomous auto-booking. | If you want full self-serve booking, §1's escalation rules loosen. |
| 4 | Clinical documents are **drafted only**; a licensed practitioner reviews and signs before issue. There is no auto-send path, and there shouldn't be — an AI unilaterally issuing a clinical/legal document is not something to set up regardless of preference. | Not negotiable in this design. |
| 5 | Medical records work is **organizing, summarizing, and filing** notes a practitioner already wrote or dictated — never independently generating diagnoses or chart entries. | Not negotiable in this design. |
| 6 | Jurisdiction is the **Philippines**: compliance is written around the Data Privacy Act of 2012 and NPC guidance on Sensitive Personal Information. | Elsewhere — swap the compliance section entirely. |
| 7 | Payment reminders are **informational nudges** about balances and upcoming due dates, not automated collection or refunds. | Collections/refunds need a payment gateway and a separate decision. |

## AI does vs. human approves, by module

| Module | AI does | Stays human | Needs to be connected |
|---|---|---|---|
| **Scheduling** | Checks availability, proposes slots, books/reschedules on confirmation | Judgment calls on urgent symptoms, package/insurance sessions, conflicts it can't resolve | Calendar or booking system (Google Calendar, Square, EMR module) |
| **Dashboard** | Pulls and formats live status (appointments, no-shows, balances) | None — read-only reporting | Same calendar/booking system; payment/POS if financial data included |
| **SMS/email follow-up** | Drafts and sends reminders, follow-up nudges, payment reminders from templates | Anything beyond scheduling/payment content — no clinical info in messages | SMS gateway (Semaphore, Movider, Twilio) + email service |
| **Medical records** | Files, organizes, summarizes notes a practitioner already wrote | Any new clinical content, diagnosis, or finalized record changes | EMR or secure file storage |
| **Prescriptions / med certs** | Drafts the document from practitioner-supplied details | Review, edits, and signature before release to patient | Document template / EMR |

The common thread: everywhere PHI or a clinical/legal decision is involved, the AI's output is a
draft or a read-only view — never a final action taken on a patient without a human checkpoint.

## Dashboard spec (assumed defaults)

- **Shows**: today's/week's appointments by practitioner and status, open slots remaining,
  no-show/cancellation rate, and — if payments are in scope — balances due and payments received.
- **Viewers**: clinic owner and front-desk staff. If practitioners should see only their own patient
  list (common for privacy), restrict their view accordingly rather than giving blanket access.
- **Where it lives**: simplest start is Claude generating the summary on request, inside whatever
  chat tool you already use daily (Claude Project, or Slack via Claude Tag). A standalone live web
  dashboard is possible but needs the calendar/payment data to be *queryable by an app*, not just
  readable in chat — worth doing once the underlying systems are chosen.
- **Data source**: the same booking/calendar system as scheduling, plus the payment/POS system if
  payment reminders should reflect real balances rather than manual entries.

## Compliance notes (not legal advice)

- Patient health information is **"sensitive personal information" under the Philippine Data Privacy
  Act of 2012 (RA 10173)**. In practice: get patient consent for how their data is used, limit access
  to who needs it, and be able to show reasonable safeguards if asked by the National Privacy
  Commission.
- If any part of this system routes PHI through a third-party AI/API, SMS gateway, or cloud tool,
  check that provider's data-handling terms and, where relevant, get patient consent that covers this.
  A line in your intake form is often enough — a lawyer can confirm the wording.
- **Keep an audit trail**: who accessed which record, when a document was drafted vs. signed, when a
  message was sent to a patient. This protects the clinic as much as the patient if something is
  disputed later.
- This sets up sensible guardrails but is **not a compliance certification**. For anything involving
  licensing (PRC numbers on documents, e-signature validity for medical certificates), confirm with
  your professional regulatory body and, if budget allows, a lawyer familiar with Philippine health
  data rules.

### ⚠️ And note where this file lives

`Gaerlan51/Gaerlan51` is a **public** GitHub profile repo — everything in it is world-readable. The
prompt and these notes contain no patient data and are safe here. A patient list, a chart note, a
sample medical certificate with a real name on it, or your clinic's payment account details are not:
none of those belong in this repo at any point. If the clinic system grows past a prompt file, move
it to a private repo first — `scripts/move-to-private.sh` does the equivalent move for the
consulting toolkit and is a usable template.

## Next steps — every `[CONNECT: ...]` needs a real system

The prompt works as-is for drafting and reasoning tasks. But until each `[CONNECT:]` placeholder
points at something real, scheduling, messaging, and the dashboard can only *describe* what to do,
not act. Fastest path:

1. **Pick the booking/calendar system.** If there's none yet, Google Calendar plus a simple form is
   enough to start. Unlocks §1 and §2.
2. **Pick an SMS/email provider for the Philippines** (Semaphore, Movider, or email-only if SMS
   cost/setup is a blocker). Unlocks §3.
3. **Decide who signs prescriptions/certificates** and confirm your template's required fields
   (PRC/PTR numbers, clinic letterhead). Unlocks §5 immediately — no integration needed.
4. **Decide whether records stay on paper/spreadsheet or move to a lightweight EMR.** Determines how
   much of §4 can actually be automated versus just formatted.

Once the real tools are chosen, the `[CONNECT:]` sections can be tightened into tool-specific
instructions (exact Google Calendar or Twilio steps) instead of placeholders.

## What this prompt does *not* do

Same shape as the consulting system in this repo — it is a strong front-desk brain, but on its own it
does **not**:

- book a real appointment or hold a real slot,
- send an SMS or email by itself,
- update a live dashboard by itself,
- see your calendar, records, or balances unless a tool is connected that reads them,
- or issue any prescription or medical certificate, ever.
