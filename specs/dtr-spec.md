# Build spec — `dtr`, the Daily Time Record system

**Status: implemented.** The system exists — `dtr/`, `config/dtr.toml`, `tests/dtr/`,
`python -m dtr`. This file is the record of what was asked for, which open decisions were taken and
why, and the reference for anyone changing it.

---

## 1. The problem

A business of fewer than fifty people keeps time by hand. Three things go wrong:

1. **Records get manipulated.** Entries are edited after the fact, backdated, or made by a colleague
   on someone else's behalf.
2. **Data reaches payroll too late** to act on.
3. **Typing it in introduces errors.**

The answer asked for: QR scan-in and scan-out, and a dashboard that shows attendance as it happens.

**The one-line test of success:** an employee scans the poster at the door and their supervisor sees
it on the board before they have taken their coat off — and nobody, including the owner of this
repository with a SQL prompt open, can quietly change what it says afterwards.

---

## 2. Non-negotiable constraints

Violating any of these means the change is wrong, however convenient it is.

1. **The server owns the clock.** The recorded time is `datetime.now()` on the server at the moment
   the request is accepted. No code path writes a time supplied by a client. `ScanRequest` has no
   timestamp field, and `tests/dtr/test_scan.py` asserts that it never grows one.
2. **Employees cannot edit.** There is no employee-facing endpoint that updates or deletes a record.
   Corrections go through a request an approver reviews.
3. **`dtr_logs` and `audit_log` are append-only, enforced in SQLite.** Triggers refuse `DELETE`
   outright and refuse any `UPDATE` that touches a factual column. This is not application logic
   that a bug or a shell can step around — see `dtr/db.py` and `tests/dtr/test_immutable.py`.
   The single exception is retention purging, gated on the `guards` table, which
   `purge_expired()` flips for the length of one transaction and always flips back.
4. **A correction appends, never rewrites.** Approval writes a *new* row marked
   `source='admin_correction'` and points the old row at it via `superseded_by_id`. Both rows
   survive. A void sets `voided_at` and keeps the row.
5. **Every consequential act is audited** with old value, new value, actor, time and reason —
   including refused scans, viewed photos and CSV exports.
6. **No personal data in the repository.** The database, photos and the signing key live under
   `data/`, which is gitignored. Seed and test data use obviously fictional people.
7. **No offline queue.** See §3.5.

---

## 3. The decisions that were open, and what was chosen

The original brief flagged six decisions. Each was put to the owner before the relevant code was
written. What follows is the choice and its consequence, so a future reader can reopen one
knowingly.

### 3.1 QR mechanism — **static poster plus geofence**

Rejected: a rotating time-boxed token, and the two combined.

A static poster is one printed sheet at the door with no tablet, no screen and no clock to keep in
sync. The cost is that the code itself is not a secret: anyone who photographs the poster has it
forever. **All of the anti-manipulation weight therefore falls on the GPS check**, and `dtr/geo.py`
is written accordingly:

* a fix with no accuracy figure is not a fix, and is refused;
* a fix wider than the location's tolerance is **refused, not accepted-and-flagged** — a two-kilometre
  accuracy circle that happens to contain the office proves nothing;
* a stale fix is refused, because a cached position is precisely what a phone hands back when it is
  nowhere near the office;
* a reading outside the radius but inside its own error bars is recorded **and flagged**, never
  silently dropped, because refusing an honest employee creates a payroll dispute.

The poster payload is `CODE.signature`, HMAC-signed with the server key, so a hand-printed QR is
refused before it reaches the database. Codes use an alphabet without `I`, `L`, `O`, `0` or `1`,
because the same code is printed underneath in plain text for anyone whose camera will not focus.

**Residual risk, stated plainly:** a determined employee with a rooted phone and a mock-location app
can defeat a geofence. If manipulation persists after rollout, the fix is to add the rotating token
(option A of the original brief) — `dtr/security.py` already has the signing primitives, and only
the poster display and the payload check would change. Turning on photo capture (§3.2) is the
cheaper intermediate step.

### 3.2 Selfie capture — **built, off by default**

The capture path, storage, admin review and retention all exist. Every location ships with
`require_photo = 0`, and an admin ticking the box is not enough on its own: the employee must first
accept the photo notice in `dtr/consent.py`. Photos are stored outside the repository, served only
to a supervisor or admin, and **viewing one is itself written to the audit log**. They age out on
their own schedule, sooner than the time records they belong to.

Deliberately *not* facial recognition: no template is computed and no automatic matching happens.
That distinction is stated in the notice, because it is the difference between an ordinary photo and
processing that attracts far heavier obligations.

### 3.3 Employee client — **mobile PWA**

Installable, camera-capable, no app store. For one site and fewer than fifty people the trade is
plainly right: it ships today and updates instantly.

The scan flow deliberately avoids shipping a QR decoder. The poster encodes a URL into the app with
the payload in the fragment, so the **phone's own camera app** does the reading — which every iOS
and Android phone can do. In-app scanning via `BarcodeDetector` is offered where it exists, and
typing the printed code is the last resort. The app acts on the payload both on load
and on `hashchange`, because scanning while the app is already open focuses the existing
window rather than reloading it. Nothing is loaded from a CDN; the
Content-Security-Policy is `'self'` with no `unsafe-inline`, which is why there is not one inline
style or event handler in the markup.

### 3.4 Breaks — **time in and time out only**

Four scans a day means four chances to forget one, and each miss becomes a correction request for a
human to process. Instead each shift carries an unpaid `break_minutes` deducted once the day passes
`break_after_minutes` — 300 by default, matching the Labor Code's meal period for work of more than
five hours. Both numbers are per-shift settings.

### 3.5 Offline scanning — **blocked**

No connection, no clock-in; the app says so in as many words. This is the decision most likely to be
questioned later, so the reasoning is recorded here: a queued offline punch has to trust the phone's
clock, and the phone's clock is exactly the thing constraint 1 exists to keep out of the database.
Accepting one would put a client-supplied timestamp back into the record and undo the system's main
claim. The service worker caches the app shell and pointedly refuses to cache or queue anything
under `/api/`.

If a site's signal turns out to be genuinely unreliable, the honest fix is a second poster location
or wifi at the door — not a queue.

### 3.6 Jurisdiction — **Philippines**

`retention_days` defaults to 1095 (three years) and `Settings` refuses to start below it. The
consent notices are written against the Data Privacy Act of 2012: purpose, the specific data, who
sees it, how long it is kept, and the rights to access and correct.

**This is a starting draft, not legal advice.** Have counsel or your DPO review the notices before
rollout and record the version they approved in `consent_version`, which is stored against each
employee's acceptance so that rewording requires a fresh yes.

---

## 4. What the anti-manipulation controls actually are

| Control | Where | Behaviour |
| --- | --- | --- |
| Server-authoritative time | `dtr/scan.py` | The only clock read is the server's. |
| Signed poster | `dtr/security.py` | A QR not issued here is refused before any lookup. |
| Geofence | `dtr/geo.py` | Distance, accuracy ceiling and fix freshness, all three. |
| Device binding | `dtr/scan.py` | First scan claims the phone; a different one is recorded **and flagged**. Unbinding is an admin act with a reason, audited. |
| One open session | `dtr/store.open_entry` | While a time-in is open the next scan can only be a time-out. |
| Double-tap guard | `dtr/scan.py` | Two scans inside a minute are one punch. |
| Missing time-out | `dtr/scan.py`, `dtr/live.py` | Yesterday is never auto-closed. A new day opens, the stale day is flagged, and a correction fixes it. |
| No employee edit path | `dtr/api/routes_employee.py` | Read-only, asserted by test. |
| Separate admin session | `dtr/auth.py` | A PWA session can never reach a dashboard route, even for an admin. |
| Issued passwords expire on use | `dtr/api/deps.py` | An account still holding a password someone else chose can sign in and do nothing else until it sets its own. Enforced server-side, because the person who issued it must not be able to act as the account. |
| Append-only storage | `dtr/db.py` | SQLite triggers, not application politeness. |
| Audit trail | `dtr/audit.py` | Including refusals, photo views and exports. |

---

## 5. Layout

```
dtr/
  config.py      settings; env > config/dtr.local.toml > config/dtr.toml
  db.py          schema, the append-only triggers, retention purging
  security.py    passwords, session tokens, poster signatures
  geo.py         haversine and the geofence verdict
  timerules.py   shifts, the business day, the hours arithmetic
  scan.py        the scan pipeline — the heart of the system
  corrections.py the approval workflow
  reports.py     employee-days, totals, CSV
  live.py        the realtime board and the WebSocket hub
  auth.py        sessions, roles, visibility
  consent.py     the DPA notices
  audit.py       the trail
  api/           FastAPI routers
  web/app        the employee PWA
  web/admin      the dashboard
```

Business rules live in the plain modules and are tested without the web layer; `dtr/api/` only
translates HTTP. `tests/dtr/test_api.py` skips itself if FastAPI is not installed, so the core suite
runs on a bare Python 3.11.

---

## 6. Deviations from the original brief

1. **`break_after_minutes` was added to shifts.** The brief implied a flat break deduction; deducting
   an hour from a three-hour day is wrong, so the deduction has a threshold.
2. **`voided_at` and `voided_by_id` were added to `dtr_logs`.** The brief's data model had no way to
   express "this entry should not exist" without deleting the row, which constraint 3 forbids.
3. **The scan endpoint does not accept an entry type.** The brief's model has a `type` column; the
   client does not get to choose it. It is derived from whether a time-in is open, which is what
   makes the one-open-session rule enforceable rather than advisory.
4. **A consent gate blocks the first scan** until the location notice is accepted. Not in the brief,
   but implied by its own privacy requirement, and cheaper to build now than to retrofit.
5. **A handed-out password is not a credential.** The brief's role table assumes authentication
   exists; it does not say what a password issued by HR is worth. Here it is worth exactly one
   thing: signing in to replace itself. Otherwise the person who typed the temporary password into
   the dashboard can clock in as the employee they created, which would reopen buddy punching
   through the front door.

---

## 7. Still to do before this runs a real payroll

- Have the consent notices reviewed locally, and set `consent_version` to what was approved.
- Run behind HTTPS. Cookies only set `Secure` when `base_url` is `https://`, and the browser will
  not give a page geolocation or camera access over plain HTTP anyway, except on `localhost`.
- Set `DTR_SECRET_KEY` from your secret store rather than letting the generated
  `data/dtr/secret.key` be the only copy, and back that file up — losing it invalidates every
  printed poster.
- Decide who holds admin. Accounts created from the dashboard, and any password an admin resets,
  are marked `must_change_password`; the API then refuses every route but "who am I" and "set my
  password" until the holder picks their own. Seeded demo accounts are the one exception, so the
  demo stays usable — see `dtr/seed.py`.
- Schedule `python -m dtr purge --yes` on a cron. It sweeps both windows: scan photos past
  `photo_retention_days`, and time records past `retention_days`. Satisfy yourself both figures
  are right for you before the first run — it deletes, and the trigger that normally prevents
  that is deliberately open for the length of the transaction.
