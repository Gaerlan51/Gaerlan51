# Build spec — `ops`, the consulting practice toolkit

**Status: implemented.** The toolkit exists — `ops/`, `templates/`, `tests/`, `./ops.sh`. This file
stays as the record of what was asked for and why, and as the reference for anyone changing it.
Deviations from the spec as written are listed in §11.

**How this file was used:** open Claude Code in the repo root and say
*"Implement `specs/ops-toolkit-spec.md`."* This document is the prompt. It is written to be
executed without follow-up questions; where a decision is genuinely open, it says so and names the
default to take.

---

## 1. What you are building and why

A single-operator statistics consulting practice currently runs on a spreadsheet, Messenger threads,
and a Claude Project (see `prompts/stats-consulting-master-prompt.md`). The manual parts that hurt
are: remembering who is overdue, re-typing quotes and invoices, and keeping prices consistent
between what Claude drafts and what the owner actually charges.

Build `ops`: a local, offline command-line tool that owns the tracker, the price list, and the
document templates. It does **not** talk to clients, send anything, or take payments. It prepares
text the owner reads, edits, and sends by hand.

**The one-line test of success:** the owner runs `ops status` each morning and knows exactly who to
message today, and never types a price into a client message that isn't in the config.

---

## 2. Non-negotiable constraints

Violating any of these means the change is wrong, however elegant it is.

1. **Python 3.11+, standard library only.** No pip installs, no virtualenv required. `tomllib`,
   `csv`, `argparse`, `datetime`, `string.Template`, `dataclasses`, `unittest` cover all of it.
   If you believe a dependency is unavoidable, stop and explain rather than adding one.
2. **No network calls.** Not for pricing, not for sending, not for telemetry. The tool must work on
   a laptop with the wifi off.
3. **Never commit client data.** The tracker lives in `data/clients.csv`, which is gitignored.
   No test fixture, docstring, example, or README may contain a real-looking client record — use
   obviously fictional names (`Test Student A`, `Sample University`).
4. **Never invent a price.** If a service's `price` is `0` or the key is missing, the tool prints
   `[PRICE NOT SET — ask owner]` in the rendered document and exits non-zero with a message naming
   the file to edit. It never estimates, interpolates, or falls back to a market rate.
5. **Never write payment instructions.** How the owner gets paid is not stored anywhere and not
   generated. The invoice carries a literal marker for the owner to replace by hand.
6. **Every write is undoable.** Before rewriting `data/clients.csv`, copy it to
   `data/.backups/clients-<ISO8601 timestamp>.csv`. Keep the last 20 backups, prune older.
7. **The tool never sends anything.** Generated documents go to `out/`. Delivery is manual.

---

## 3. Repository layout to produce

```
ops/
  __init__.py
  __main__.py          # argparse entry point; `python -m ops <command>`
  config.py            # loads services.toml + services.local.toml overlay
  tracker.py           # CSV read/write, schema, backups, status transitions
  money.py             # currency formatting, rush multiplier, extra-test math
  render.py            # string.Template rendering with strict placeholder checks
  followups.py         # the "what needs attention today" rules from §6
  commands/
    __init__.py
    add.py  list.py  status.py  quote.py  invoice.py  remind.py  report.py  services.py
templates/
  quote.md  invoice.md  report-skeleton.md
  reminder-payment-gentle.md    reminder-payment-firm.md
  reminder-consult.md           reminder-checkin.md   reminder-delivery.md
tests/
  test_config.py  test_tracker.py  test_money.py  test_followups.py  test_render.py
ops.sh                 # one-line wrapper: exec python3 -m ops "$@"
```

Do not add a `setup.py`, packaging metadata, or an installer. `./ops.sh status` is the whole install
story; mention it in `prompts/operator-notes.md` when you're done.

---

## 4. Data model

### 4.1 Tracker schema — `data/clients.csv`

Column order is fixed and matches the tracker format in the master prompt (§3), with `id` prepended
so rows can be addressed from the CLI.

| Column | Type | Notes |
|---|---|---|
| `id` | string | `<lowercase surname>-<YYMM>`, deduped with `-2`, `-3` on collision. Stable forever. |
| `date_inquired` | ISO date | `YYYY-MM-DD`. |
| `name` | string | |
| `school` | string | |
| `thesis_topic` | string | |
| `stage` | enum | `proposal` \| `data_collected` \| `defense_ready` |
| `service_requested` | string | Must match a `service.id` in the config, or `other`. |
| `deadline` | ISO date or empty | Client's deadline, not yours. |
| `status` | enum | See §4.2. |
| `quoted_price` | decimal or empty | Store as a plain number; format only at render time. |
| `payment_status` | enum | `unbilled` \| `invoiced` \| `partial` \| `paid` \| `written_off` |
| `next_followup` | ISO date or empty | |
| `notes` | string | Free text; newlines escaped as `\n` on write. |

Read with `csv.DictReader`, write with `csv.DictWriter` and `quoting=csv.QUOTE_MINIMAL`. If the file
is missing, `ops` creates it with the header row on first write, and every read command reports
"no tracker yet — run `ops add`" rather than raising.

### 4.2 Status values and legal transitions

```
New Inquiry → Scoping → Quoted → Awaiting Payment → In Progress → Delivered → Follow-up → Closed-Won
                                                                                        ↘ Closed-Lost
```

Store them lowercase-hyphenated internally (`new-inquiry`, `awaiting-payment`, `closed-won`) and
render them in the display form above.

Any status may move to `Closed-Lost` — clients go quiet at every stage. Otherwise a status may move
only forward along the arrows, or one step back (mistakes happen). `ops set-status` rejects an
illegal jump with a message naming the legal next values, unless `--force` is passed.

### 4.3 Config — `config/services.toml` + `config/services.local.toml`

Both are TOML, loaded with `tomllib`. `services.local.toml` overlays the committed file **key by
key** (a `[[service]]` entry with a matching `id` replaces that service's changed keys only; it does
not have to restate the whole entry). The committed file already exists — read it before writing
`config.py`, and treat its shape as fixed.

Surface a clear error, naming the offending key, when: a service `id` is duplicated, a
`turnaround_days` pair isn't `[min, max]` with `min <= max`, or `rush.multiplier < 1.0`.

---

## 5. Commands

Every command takes `--tracker PATH` (default `data/clients.csv`) and `--config PATH`. Every command
that produces a client-facing document writes to `out/<id>-<kind>-<date>.md` **and** prints it to
stdout, so the owner can pipe it or copy it.

### `ops add`
Flags for every tracker column (`--name`, `--school`, …). Missing required fields (`name`,
`service_requested`) are prompted for interactively; if stdin is not a TTY, error instead of hanging.
Generates the `id`, defaults `date_inquired` to today and `status` to `new-inquiry`, sets
`next_followup` to today + 2 days.

Also accept `ops add --from-intake FILE`: a file containing a pasted inquiry, which you parse
best-effort into fields, print for confirmation, and only then write. Parsing failures are fine —
fall back to prompting for what you couldn't extract. Do not use an LLM call; simple regex/heuristics
on labelled lines is the intended level of effort.

### `ops list [--status S] [--payment-status P] [--overdue]`
Fixed-width table to stdout, sorted by `next_followup` ascending then `deadline` ascending. Empty
result prints a plain "nothing matches" line, not an empty table.

### `ops status`
The morning dashboard, and the most important command here. Prints, in sections, each with the
client `id` so the next command is obvious:

- **Overdue follow-ups** — `next_followup` < today.
- **Due today.**
- **Unpaid past terms** — `payment_status == invoiced` and invoice date + `payment_terms_days` < today.
- **Deadline risk** — `status == in-progress` and `deadline` within 3 days.
- **Gone quiet** — no status change in 10+ days while in `scoping`, `quoted`, or `awaiting-payment`.

Exit 0 always (this runs in a shell prompt or cron; a non-zero exit for "you have work" is wrong).
End with a one-line summary: `4 need attention, 12 tracked.`

To compute "no status change in N days" you need history: append every status change to
`data/history.csv` (`id,timestamp,field,old,new`). That file is gitignored with the rest of `data/`.

### `ops quote <id> [--service S] [--tests N] [--rush/--no-rush]`
Computes from config: base price, plus `price_per_extra_test × max(0, tests - 3)` for `analysis`,
times `rush.multiplier` when the client's deadline falls inside the service's turnaround (auto-detect
from the tracker; `--rush/--no-rush` overrides). Renders `templates/quote.md`. Writes the computed
figure back to `quoted_price` and moves status to `quoted` — but only with `--commit`; without it,
this is a dry run that prints the document and says "not saved; re-run with --commit".

A service priced `0` (i.e. `full_package`) refuses to compute, per constraint 4.

### `ops invoice <id> [--amount X] [--commit]`
Renders `templates/invoice.md` with amount due (defaults to `quoted_price`), due date
(today + `payment_terms_days`), and a **How to pay** section holding the literal marker
`[ADD YOUR PAYMENT INSTRUCTIONS HERE BEFORE SENDING.]` — the owner writes the real instructions into
each invoice. With `--commit`, sets `payment_status = invoiced` and records the invoice date in
`data/history.csv`.

### `ops remind <id> --kind {payment,consult,checkin,delivery} [--tone {gentle,firm}]`
Renders the matching template. For `payment`, `--tone` is required and the tool prints **both**
variants when it is omitted — the master prompt's §6 rule that the owner picks the firmness level,
enforced in code.

### `ops report <id>`
Copies `templates/report-skeleton.md` to `out/`, pre-filling client name, date, and the research
questions from `notes` if present. The skeleton carries the section order from master prompt §4.3 and
the integrity footer **verbatim** — copy that sentence from the prompt file, don't paraphrase it.
This command scaffolds a document for the owner to fill in; it must never generate results, numbers,
or interpretation.

### `ops services [--markdown]`
Prints the resolved service menu (committed + local overlay). `--markdown` emits the table the owner
attaches to their Claude Project, with a `Price` column and a generated-on date. Unset prices render
as `[PRICE NOT SET]`, loudly.

### `ops set-status <id> <status> [--force]` and `ops set <id> <field> <value>`
Validated writes, per §4.2, each appending to history.

---

## 6. Follow-up rules (`followups.py`)

Pure functions over a list of rows plus a `today` argument — no I/O, no `date.today()` inside them,
so tests can pin the date. Each returns `(row, reason_string)` pairs; `ops status` only formats.

Defaults, all overridable in `[followups]` in the config: quote follow-up 3 days after `quoted`,
payment reminder 3 days after invoice (gentle) and 7 days (firm), check-in after 10 days of silence,
delivery follow-up 2 days after `delivered`.

---

## 7. Templates

`string.Template` with `${placeholder}` syntax. `render.py` must fail loudly on an unfilled
placeholder rather than emitting `${amount_due}` into a document that goes to a client — that is the
single highest-consequence bug available in this codebase, so test it directly.

Template voice follows master prompt §8: professional, warm, plain-language, no guarantees about
grades or defense outcomes, no positioning as a substitute for the adviser. Keep them short —
Messenger-length for reminders, one page for quotes and invoices.

---

## 8. Tests

`unittest`, runnable as `python -m unittest discover tests`. No network, no filesystem writes outside
`tempfile`. Cover at minimum:

- `id` generation, including the collision path.
- Config overlay: local file overrides one key of one service and leaves the rest intact.
- **Unset price refuses to quote** and exits non-zero.
- **Unfilled template placeholder raises** rather than rendering.
- Rush multiplier applies when the deadline is inside the turnaround window, and not when outside.
- Extra-test math at the boundary (3 tests = no surcharge, 4 = one).
- Illegal status transition rejected; `--force` allows it.
- Tracker round-trips a row containing a comma, a quote character, and a newline in `notes`.
- `ops status` on a missing tracker file prints guidance and exits 0.

Fictional client data only.

---

## 9. Out of scope

Do not build, and do not stub: Google Sheets sync, email or Messenger sending, a web UI, a payment
gateway, PDF export, or any statistical computation. The tool tracks the business; the statistics
happen in the owner's stats software and the Claude Project.

Two of these are deliberately deferred rather than rejected — Sheets sync and a payment gateway
become worth building at maybe 10+ concurrent clients. Keep `tracker.py`'s read/write surface narrow
enough that a different backing store could be swapped in later, and leave it at that. No abstraction
layer, no plugin system, no "future-proofing" today.

---

## 10. Definition of done

- [ ] `./ops.sh status` works on a fresh clone with no tracker file and no local config, printing
      guidance rather than a traceback.
- [ ] The full flow runs end to end with fictional data:
      `add → quote --commit → invoice --commit → remind --kind payment → set-status delivered → report`.
- [ ] `python -m unittest discover tests` passes.
- [ ] `git status` is clean of `data/`, `out/`, and `config/services.local.toml`.
- [ ] `grep -rn "PRICE NOT SET" ops/ templates/` shows the guard is actually wired into rendering.
- [ ] `prompts/operator-notes.md` gains a short "Using the toolkit" section with the five commands
      the owner will actually run daily.

Report at the end: what you built, anything in this spec that turned out wrong or underspecified, and
what you'd cut if the owner only ever ran one command.

---

## 11. Deviations from the spec as built

Recorded here rather than silently absorbed, so the spec and the code don't drift apart.

- **Extra files in `ops/commands/`.** `_common.py` (shared loading and document-writing helpers) and
  `setters.py` (`set-status` and `set`, which §5 specifies but §3's layout gave no home).
- **`tests/test_cli.py` added.** Three items §8 requires — an unset price exiting non-zero, `--force`
  overriding a transition, `ops status` on a missing tracker — are command-level behaviours, and the
  five test files in §3 are all unit-level. 88 tests total.
- **Global `--today YYYY-MM-DD` flag, not in the spec.** Date-dependent behaviour (rush detection,
  overdue follow-ups, days outstanding) is otherwise untestable without pinning the system clock, and
  it doubles as a way to preview next week's dashboard. History entries honour it too, so a
  back-dated invoice dates its reminders correctly.
- **Global `--history` and `--out-dir` flags** for the same reason: tests must not write to the real
  `data/` or `out/`.
- **`quote --commit` will not force an illegal status move.** §5 says it moves status to `quoted`; if
  the client is already further along (say `delivered`), it prices the job, leaves the status alone,
  and says so. Re-quoting late work is a real case; corrupting the pipeline for it isn't worth it.
- **`[followups]` is absent from the committed `config/services.toml`.** The defaults in §6 apply
  until the owner adds the section, which keeps the committed config free of numbers to maintain.
- **The payment scheme was removed after the first build.** The original spec had a `[payment]`
  config block (method, account name and number, a QR path, an instructions template) that the
  invoice command rendered into each document. That is gone: no account details live in the repo,
  the config, or the Claude Project, and neither the tool nor the prompt will compose payment
  wording. `ops invoice` prints an unmissable marker instead. An invoice sent with the marker still
  in it is embarrassing and fixable; one sent with a stale or wrong account number is neither.
