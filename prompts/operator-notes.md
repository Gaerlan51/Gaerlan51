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
| `config/services.local.toml` | Your real prices. **Untracked — never committed.** |
| `specs/ops-toolkit-spec.md` | Build spec for the toolkit. Kept as the record of what was built and why. |
| `scripts/serve.py` | Run the site locally, the way Vercel serves it. |
| `scripts/move-to-private.sh` | One-shot move of this system into a private repo. |
| `ops/`, `templates/`, `tests/` | The toolkit itself. Run it with `./ops.sh <command>`. |
| `web/` | The public site: `index.html`, `login.html`, one stylesheet, one script. |
| `data/` | Client tracker CSV. **Untracked — contains client personal data.** |
| `out/` | Generated quotes, invoices, reports. **Untracked.** |

## ⚠️ This repo is your public GitHub profile repo

`Gaerlan51/Gaerlan51` renders its root `README.md` on your GitHub profile, and everything in it is
world-readable. That has two consequences:

1. **Never commit client data.** Names, schools, thesis topics, contact details, and deadlines are
   personal information about identifiable students. `data/` is gitignored for this reason — keep it
   that way, and don't paste tracker contents into a committed file.
2. **Never commit your real prices.** Those live in `config/services.local.toml`,
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
   real figures and your rush multiplier.
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

The tool refuses rather than guesses: an unpriced service or an unfilled
template placeholder stops the command with an error naming the file to fix. That is deliberate.
A blank in a document you send a client is worse than a command that won't run.

## The website

`web/` is a static site — no framework, no build step needed to deploy. Upload the folder to any
static host and it works as-is. `python3 scripts/build-site.py` optionally flattens each page into a
single self-contained file in `web/dist/` if your host prefers that.

### Getting it onto your computer

Everything lives at <https://github.com/Gaerlan51/Gaerlan51>. Two ways down:

**With git** (keeps you able to pull later changes):

```sh
git clone https://github.com/Gaerlan51/Gaerlan51.git
cd Gaerlan51
```

**Without git** — on the repo page, **Code → Download ZIP**, then unzip it and open a terminal in
that folder. Nothing here needs a build step, so the ZIP is complete as it stands.

You need **Python 3.11 or newer** for the tracker toolkit (it reads the config with `tomllib`, added
in 3.11). Check with `python3 --version`, or `python --version` on Windows. The website itself needs
no Python at all — the four files in `web/` open in any browser.

On macOS and Linux the toolkit runs as `./ops.sh status`. On Windows that shell script does not run;
use `python -m ops status` instead — same program, same arguments.

### Running it on your own machine

```sh
python3 scripts/serve.py          # http://localhost:8000
```

Opening `web/index.html` straight off disk mostly works, but it is not what a visitor gets —
`file://` resolves paths differently and never exercises the clean URLs. The script mirrors
`vercel.json`, so `/` and `/login` behave locally exactly as they will once deployed. Pass a port
number if 8000 is busy. Ctrl-C stops it.

### Going live (Cloudflare Pages)

Free, and its free tier permits commercial use — which Vercel's Hobby tier does not, and this is a
business site. Nothing to install; it builds from GitHub.

1. **dash.cloudflare.com** → create a free account.
2. **Compute (Workers & Pages)** → **Create** → **Pages** → **Connect to Git**.
3. Authorise GitHub and pick **Gaerlan51/Gaerlan51**.
4. Build settings — the only screen that matters:
   - Framework preset: **None**
   - Build command: **leave empty**
   - Build output directory: **web**
   - Production branch: **main**
5. **Save and Deploy.** About a minute later you have `<project>.pages.dev`.

Every push to `main` redeploys by itself. `web/_headers` sets the security headers there;
`vercel.json` does the same job if you ever move to Vercel. Clean URLs (`/login`) work on both.

A custom domain, when you buy one, goes under the project's **Custom domains** tab — Cloudflare
issues the certificate.

### Deploying to Vercel (alternative)

`vercel.json` in the repo root already points Vercel at `web/`, so there is nothing to configure:

1. Go to vercel.com, sign in with GitHub, and click **Add New → Project**.
2. Import this repository. Leave the framework preset as **Other**; do not set a build command.
3. Deploy. You get a live URL at `<project>.vercel.app` in about a minute.

Every push to the branch redeploys automatically. A custom domain, when you have one, is added under
the project's **Domains** tab — Vercel issues the HTTPS certificate itself.

Two settings worth knowing about: `cleanUrls` serves the sign-in page at `/login` (the `.html` links
still work, they just redirect), and three security headers are set for every response. Neither
needs your attention; they are there so you do not have to think about them.

**Before you deploy, remember the site becomes public**, with your Gmail address on it and the
wordmark as it currently reads. Both are one edit away if either is wrong.

Nothing is left as a placeholder — the site is complete and deployable as it stands.

Contact is `gaerlanbong226@gmail.com`, shown on the enquiry notice, the footer, and the sign-in
page. Two things worth knowing about publishing it: a plain address on a public page collects spam
within weeks, and a personal Gmail reads differently from a business address to a client comparing
consultants. Neither is a reason not to launch — but a forwarding address on your own domain later
is cheap, and swapping it is one string in two files.

To add Messenger as a second route once you have a page, put this back in the footer's Clients list
and in the enquiry notice, with your real handle:

```html
<li><a href="https://m.me/YOUR-HANDLE">Message on Messenger</a></li>
```

The enquiry form submits nowhere by design: it composes a labelled message the visitor copies and
sends you. Those labels are exactly what `ops add --from-intake` parses, so an enquiry pasted from
Messenger into a file goes into the tracker without retyping.

`login.html` is a front end only. Its handler never reads the password field and never stores or
sends anything, and the page says so plainly when someone submits it. Do not put it in front of real
clients until there is an actual account system behind it — a sign-in box that appears to work but
doesn't is worse than no portal at all.

## What this prompt does *not* do

It makes Claude a strong intake / consulting / ops brain. It does **not**:

- collect payments,
- send messages on its own,
- update a live dashboard by itself,
- or see your tracker unless you paste it in (or connect a tool that reads it).

Those need a spreadsheet or the local toolkit now, and later Zapier/Make plus a payment gateway
(PayMongo/Xendit) once volume justifies automating what you currently do by hand.

## Known gaps to close as you go

- **Payment instructions are written by hand, every time.** Nothing stores how you get paid — no
  account number lives in this repo or in the Claude Project. `ops invoice` prints
  `[ADD YOUR PAYMENT INSTRUCTIONS HERE BEFORE SENDING.]` where they go, and the prompt is told never
  to write them for you. It is deliberately impossible to miss, because an invoice that goes out
  with the marker still in it is embarrassing but recoverable, and one with a wrong account number
  on it is not.
- **Prices are unset.** Until `services.local.toml` is filled in, both the prompt and `ops quote`
  will (correctly) refuse to quote and ask you for the number instead. That's the intended failure
  mode — a delayed reply beats a wrong price sent to a client.
- **Turnarounds in the services table are aspirational.** Revise them against what jobs actually take
  after your first handful of clients; a missed self-declared deadline costs more trust than a longer
  quoted one.
- **The academic-integrity boundary in §8 is a judgment call, not a filter.** The prompt will flag
  requests that look like thesis ghostwriting, but where the line sits for a given school is yours to
  decide. Decide it once, in writing, before a paying client puts you on the spot.
