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
| `specs/ops-toolkit-spec.md` | Build spec for the toolkit. Kept as the record of what was built and why. |
| `scripts/move-to-private.sh` | One-shot move of this system into a private repo. |
| `ops/`, `templates/`, `tests/` | The toolkit itself. Run it with `./ops.sh <command>`. |
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

### Moving to a private repo

A public profile repo is a fine place for the prompt, the spec, and the toolkit — none of them
contain client data or real prices. It is the wrong place for an operational tracker. Move before
the first real client goes in, not after:

```sh
gh auth login                          # once
sh scripts/move-to-private.sh          # creates the private repo and pushes
```

The script creates and pushes only. It prints three cleanup steps to do by hand afterwards, the last
of which — deleting the work from the public repo — is the only destructive one.

No `gh`? Create an empty private repo in the GitHub web UI, then from this repo root:

```sh
git remote add private https://github.com/<you>/stats-consulting-ops.git
git push private HEAD:refs/heads/main
```

Either way your tracker never moves: `data/` is gitignored, so it lives only on your machine.

## Before first use

1. Copy the price placeholders: `cp config/services.toml config/services.local.toml`, then fill in
   real figures, your rush multiplier, and your GCash number/QR.
2. Paste `prompts/stats-consulting-master-prompt.md` into a Claude Project's Custom Instructions.
3. Attach your services table to the Project as knowledge: `./ops.sh services --markdown`.
4. Attach 1–2 past sample reports so Claude matches your house format.

## Using the toolkit

No install, no dependencies — Python 3.11+ and `./ops.sh` from the repo root. Five commands cover
almost everything:

```sh
./ops.sh status                       # who needs attention today — run this first, every morning
./ops.sh add --name "..." --service-requested analysis --deadline 2026-11-30
./ops.sh quote <id> --tests 4         # prices from the config; add --commit to save it
./ops.sh invoice <id> --commit        # marks the client invoiced, dates the payment reminders
./ops.sh remind <id> --kind payment   # prints a gentle and a firm draft; you pick
```

Also there: `list`, `report <id>` (report scaffold), `services --markdown`, `set-status`, `set`,
and `add --from-intake FILE` to parse a pasted inquiry. Every command takes `--today YYYY-MM-DD`
if you want to see what next Tuesday's dashboard will look like. `--help` on any of them.

Two habits worth forming:

- **`quote` and `invoice` are dry runs without `--commit`.** They print the document and change
  nothing. Read it, then re-run with `--commit` if it's right.
- **Documents land in `out/` and are printed to the terminal.** Nothing is ever sent for you —
  copy, edit in your own voice, and send it yourself.

The tool refuses rather than guesses: an unpriced service, a missing GCash number, or an unfilled
template placeholder stops the command with an error naming the file to fix. That is deliberate.
A blank in a document you send a client is worse than a command that won't run.

## What this prompt does *not* do

It makes Claude a strong intake / consulting / ops brain. It does **not**:

- collect GCash payments automatically,
- send messages on its own,
- update a live dashboard by itself,
- or see your tracker unless you paste it in (or connect a tool that reads it).

Those need a spreadsheet or the local toolkit now, and later Zapier/Make plus a payment gateway
(PayMongo/Xendit) once volume justifies automating what you currently do by hand.

## Known gaps to close as you go

- **Prices are unset.** Until `services.local.toml` is filled in, both the prompt and `ops quote`
  will (correctly) refuse to quote and ask you for the number instead. That's the intended failure
  mode — a delayed reply beats a wrong price sent to a client.
- **Turnarounds in the services table are aspirational.** Revise them against what jobs actually take
  after your first handful of clients; a missed self-declared deadline costs more trust than a longer
  quoted one.
- **The academic-integrity boundary in §8 is a judgment call, not a filter.** The prompt will flag
  requests that look like thesis ghostwriting, but where the line sits for a given school is yours to
  decide. Decide it once, in writing, before a paying client puts you on the spot.
