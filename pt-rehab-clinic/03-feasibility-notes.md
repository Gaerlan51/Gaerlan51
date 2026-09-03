# Feasibility Notes — Read Before Building

Four places where "automatic" isn't realistic yet, and what to build instead. These
change what you ask a builder for, so read them before pasting Part 1.

## 1. "Real-time" claims tracking from Philhealth/HMO

**Not available** to an individual clinic via public API. There is no endpoint you can
poll for claim status.

**Build instead:** a manually-updated status field
(Submitted → Pending → Approved → Paid → Denied) with automated *aging* alerts at
30/60/90 days. The automation is in the alerting and the aging math, not in fetching
status. Budget for staff time to key in status changes — assign it to a named person
per branch with a fixed weekly slot, or the tracker rots and the aging report becomes
fiction.

This is the honest, buildable version of "real-time collectible monitoring," and it
delivers most of the value: what's overdue, how overdue, and at which branch.

**Never** show staff or patients a status labeled "real-time." Label it with its
last-updated timestamp instead.

## 2. GCash

**Not directly integrable.** GCash is not an API a clinic app talks to on its own.

**Build instead:** route through a licensed payment gateway that offers GCash as a
payment method — PayMongo, Xendit, or DragonPay. The app's job shrinks to two things:
generate a payment link or QR, and receive a webhook confirming payment.

**Pick the gateway before building the payments module.** Their webhook payloads and
onboarding requirements differ enough that choosing late means rework. All three
require business registration documents, so start that paperwork in parallel — it is
usually the long pole, not the code.

## 3. Five-branch data isolation — the biggest design risk

Each branch runs independently, so the live risk is Branch A staff seeing or editing
Branch B's records.

**Push hard for strict branch-scoping from day one.** Every core record —
patients, appointments, encounters, claims, payments — carries `clinic_id`, and the
filter is applied server-side before any query runs (row-level security or
equivalent), never by hiding UI elements.

**Retrofitting access control later is painful** and, once real patient data is in the
system, is a privacy incident waiting to be discovered rather than a refactor.

Verify it the same day it's built: sign in as Branch A front desk and try to open a
Branch B record by direct URL or record ID. A denial is correct. A blank screen is not
— it usually means the data was fetched and then hidden.

## 4. No-code / low-code platform caveats

If you build on Bubble, Glide, Softr, or similar, several items in the brief may need
plugins or may not be fully supported:

- **Audit logging** — who viewed/edited/printed each record. Often needs custom
  workarounds; view-logging in particular is rarely native.
- **Complex role-based permissions** — the branch-scoping above, plus therapists
  blocked from billing and front desk limited on clinical notes.
- **PDF generation with e-signature** — usually a paid plugin, and e-signature
  frequently is not supported at all.

Check the platform's capabilities before committing, or instruct the builder to flag
gaps as it goes rather than silently simplifying. A platform that can't do audit logs
is a platform that can't hold health records under RA 10173 — treat that as
disqualifying, not as a limitation to work around.

## 5. Compliance is a day-one requirement, not a Phase 3 item

The system stores sensitive personal health information under the Philippine Data
Privacy Act (RA 10173). Three things must exist from the first working version:

- **Role-based access control**, per the roles in the brief.
- **An audit log** of who viewed, edited, or printed each patient record, and when.
- **Export to CSV/PDF.** Assume the owner eventually migrates to a certified EMR. Do
  not accept a proprietary format the data can't leave.

Beyond the software: RA 10173 also carries organizational obligations — registering
the data processing system with the National Privacy Commission, appointing a Data
Protection Officer, and having patient consent and breach-notification procedures. The
app supports those; it does not satisfy them. Confirm the specifics with counsel or
the NPC rather than assuming the build covers it.
