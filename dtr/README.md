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
python3 -m unittest discover          # everything but the HTTP layer
.venv/bin/python -m unittest discover # all of it
```
