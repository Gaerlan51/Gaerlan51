# Operator notes — read this, don't paste it

These are notes for **you**, the business owner. They are deliberately kept out of
[`stats-consulting-master-prompt.md`](stats-consulting-master-prompt.md) so that the prompt file
can be pasted whole into a Claude Project without carrying meta-commentary into the model's
instructions.

## What's in this repo

| Path | What it is |
|---|---|
| `prompts/stats-consulting-master-prompt.md` | The system prompt. Paste into Claude Project → Custom Instructions. |
| `prompts/operator-notes.md` | This file. Never pasted into the prompt. |
| `config/services.toml` | Service menu structure, committed, **prices left as placeholders**. |
| `config/services.local.toml` | Your real prices + GCash details. **Untracked — never committed.** |
| `specs/ops-toolkit-spec.md` | Build spec for the local ops toolkit. Hand to Claude Code to implement. |
| `data/` | Client tracker CSV. **Untracked — contains client personal data.** |
| `out/` | Generated quotes, invoices, reports. **Untracked.** |

## ⚠️ This repo is your public GitHub profile repo

`Gaerlan51/Gaerlan51` renders its root `README.md` on your GitHub profile, and everything in it is
world-readable. That has two consequences:

1. **Never commit client data.** Names, schools, thesis topics, contact details, and deadlines are
   personal information about identifiable students. `data/` is gitignored for this reason — keep it
   that way, and don't paste tracker contents into a committed file.
2. **Never commit your real prices or GCash number.** Those live in `config/services.local.toml`,
   which is gitignored. `config/services.toml` is the committed structure with placeholders.

If this business grows past a couple of clients, move all of this to a private repo. A public profile
repo is a fine place for the prompt and the spec; it is the wrong place for an operational tracker.

## Before first use

1. Copy the price placeholders: `cp config/services.toml config/services.local.toml`, then fill in
   real figures, your rush multiplier, and your GCash number/QR.
2. Paste `prompts/stats-consulting-master-prompt.md` into a Claude Project's Custom Instructions.
3. Attach your services table to the Project as knowledge (once the toolkit exists:
   `ops services --markdown`; before that, a hand-written table is fine).
4. Attach 1–2 past sample reports so Claude matches your house format.

## What this prompt does *not* do

It makes Claude a strong intake / consulting / ops brain. It does **not**:

- collect GCash payments automatically,
- send messages on its own,
- update a live dashboard by itself,
- or see your tracker unless you paste it in (or connect a tool that reads it).

Those need a spreadsheet or the local toolkit now, and later Zapier/Make plus a payment gateway
(PayMongo/Xendit) once volume justifies automating what you currently do by hand.

## Known gaps to close as you go

- **Prices are unset.** Until `services.local.toml` is filled in, the prompt will (correctly) refuse
  to quote and will ask you for the number instead. That's the intended failure mode — a delayed
  reply beats a wrong price sent to a client.
- **Turnarounds in the services table are aspirational.** Revise them against what jobs actually take
  after your first handful of clients; a missed self-declared deadline costs more trust than a longer
  quoted one.
- **The academic-integrity boundary in §8 is a judgment call, not a filter.** The prompt will flag
  requests that look like thesis ghostwriting, but where the line sits for a given school is yours to
  decide. Decide it once, in writing, before a paying client puts you on the spot.
