# DTR — Daily Time Record

QR clock-in for a small business, with a server-authoritative clock and time
records that cannot be edited after the fact.

Employees scan a printed poster at the door with their phone. The server checks
the phone is really there, stamps the record with **its own** clock, and shows
it on a live dashboard. Nobody — employee, supervisor or admin — can change what
was written; corrections append a new entry and leave the original in place.

The design decisions, the trade-offs behind them, and the residual risks are in
[`specs/dtr-spec.md`](../specs/dtr-spec.md). Read that before changing anything.

## Run it

```sh
./dtr.sh
```

That is the whole thing: it builds a virtualenv, installs the four
dependencies, creates the database, adds demo data on the first run only, and
starts the server. Arguments pass through, so `./dtr.sh --port 9000` works.

The same steps by hand, if you would rather see them:

```sh
python3 -m venv .venv && .venv/bin/pip install -r dtr/requirements.txt
.venv/bin/python -m dtr init          # create data/dtr/dtr.db
.venv/bin/python -m dtr seed          # demo people and a location, optional
.venv/bin/python -m dtr serve         # http://localhost:8000
```

- Employee app: <http://localhost:8000/app/> — sign in as `1003`
- Dashboard: <http://localhost:8000/admin/> — sign in as `1001`
- Demo password: `changeme123`

For a real deployment, delete the demo database and create the first account
yourself:

```sh
.venv/bin/python -m dtr admin 1001 "Your Name"   # prompts for a password
```

## Set it up

1. Sign in to the dashboard, open **Locations**, and add one. Stand at the
   entrance and press *Use my current position* — the coordinate needs to be
   where people actually scan, not where the building is on a map.
2. Print the QR poster from that card, with the code underneath in large type
   for anyone whose camera will not focus.
3. Add your people under **People**. Hand out temporary passwords in person.
4. Employees open `/app/`, sign in, replace the password you gave them, accept the
   location notice, and scan.

A password you issued lets its holder do one thing: choose a different one. Until
they do, the server refuses every other route — so nobody, you included, can clock
in as an account they set up. The same applies to a password you reset for someone.

The poster is safe to photograph — it is not a secret. What stops a remote
clock-in is the geofence, so the radius matters: 75 m is a sensible default,
20 m is below what consumer GPS can do reliably, and anything past a couple of
hundred metres starts covering the car park across the road.

## Day to day

- **Live** shows who is in, who is late, and what needs a human.
- **Approvals** is the only way a recorded time ever changes.
- **Reports** exports a CSV per employee-day, ready to hand to payroll.
- **Audit** is the record of everything, including refused scans and exports.

```sh
.venv/bin/python -m dtr poster ABCD-EFGH-JKLM   # reprint a poster
.venv/bin/python -m dtr purge --yes             # retention sweep; put it on a cron
```

## Deploy it

The app is one process with one SQLite file, so it wants a container host with
a persistent disk. `Dockerfile`, `fly.toml` and `render.yaml` are in the repo
root.

On Fly.io, after `fly auth login`:

```sh
./scripts/deploy-fly.sh my-company-dtr
```

That creates the app, the volume and the signing key, deploys, and prints the
URL. Re-run it to ship a change; it never overwrites a signing key that already
exists, because doing so would invalidate every poster on a wall.

The same steps by hand:

```sh
fly launch --no-deploy          # rewrites app and region in fly.toml
fly volumes create dtr_data --size 1 --region sin
fly secrets set DTR_SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
fly secrets set DTR_BASE_URL="https://<your-app>.fly.dev"
fly deploy --ha=false           # --ha=false keeps it to one machine
fly ssh console -C "python -m dtr admin 1001 'Your Name'"
```

On Render: point a new Blueprint at this repo, set `DTR_BASE_URL` to the URL it
gives you, and redeploy. A persistent disk needs a paid instance type — on the
free tier the filesystem is wiped on every deploy, which here means losing
employment records.

Three things that matter more than usual:

- **Run exactly one instance.** SQLite is a file on the volume, not a server.
  Two machines means two volumes, each holding half the time records and
  neither aware of the other. Both config files pin this; don't undo it. If you
  outgrow one machine, move to Postgres before scaling out.
- **Set `DTR_BASE_URL` to the real URL.** It is baked into every printed QR
  poster, and it is what makes session cookies `Secure`.
- **Back up `/data`.** It holds the database, the scan photos, and the signing
  key. `fly ssh console -C "tar cz /data" > backup.tgz` will do; losing the key
  alone invalidates every poster you have printed.

Serverless platforms do not suit this app. Vercel, Netlify Functions and Lambda
all give a function an ephemeral filesystem, so the database would be discarded
between invocations — records would appear to save and then vanish. Vercel also
does not support WebSockets on serverless functions, though that one is
survivable: the dashboard already falls back to polling. Running there would
mean Postgres for the records, blob storage for the photos, and reimplementing
the append-only triggers in PL/pgSQL. The static marketing site in `web/`
deploys to Vercel independently, and nothing here affects it.

## Configure it

`config/dtr.toml` is committed and holds nothing secret. `config/dtr.local.toml`
overlays it and is gitignored. `DTR_*` environment variables beat both.

Before going live, set `base_url` to how staff actually reach the system — it is
baked into the printed posters — and serve over HTTPS. Browsers refuse
geolocation and camera access on plain HTTP anywhere but `localhost`, so the
app simply will not work otherwise.

Keep a copy of `data/dtr/secret.key` somewhere safe. Losing it invalidates every
poster you have printed.

The seeded demo accounts skip the forced password change so you can sign in with
the password printed on screen more than once. Real accounts do not.

## Tests

```sh
python3 -m unittest discover           # the rules; no dependencies needed
.venv/bin/python -m unittest discover  # adds the HTTP layer
```

Anything a missing dependency cannot run is skipped rather than failed, so the
first command is green on a bare Python 3.11.

The browser tier in `tests/browser/` drives both front-ends in a real Chromium
and is skipped until you install it:

```sh
.venv/bin/pip install -r dtr/requirements-dev.txt
.venv/bin/playwright install chromium
.venv/bin/python -m unittest discover
```

It exists because the Python tests exercise the API the page calls, not the
page. A scan that never leaves the browser — a listener that was never wired, a
screen that never appears — passes all of them. That is not hypothetical: it is
how the `hashchange` bug in `dtr/web/app/app.js` reached a commit. Each browser
test was checked by reintroducing the bug it guards and confirming it, and only
it, fails.
