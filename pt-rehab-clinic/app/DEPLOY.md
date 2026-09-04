# Deploying to Vercel

The app lives in a subdirectory of this repository, so the one setting people get
wrong is **Root Directory** — set it to `pt-rehab-clinic/app` or the build finds no
Next.js project.

## 1. Supabase first

The public site deploys and works without a database. Everything behind `/login` does
not, so do this before you connect it.

1. Create a project in the **Singapore (`ap-southeast-1`)** region — nearest to Manila.
2. Apply the migrations in order, then the seed:
   ```bash
   for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
   psql "$DATABASE_URL" -f supabase/seed.sql
   ```
   (Or paste each file into the SQL editor, in filename order. Do not skip one —
   `0004_rls.sql` is what makes branch isolation real.)
3. Create an Auth user for each staff member, then point their `staff` row at it:
   ```sql
   update staff set auth_user_id = '<auth user uuid>' where full_name = '…';
   ```
   Nobody can sign in until this is done — that is deliberate, not a bug.

## 2. Import the repository

In Vercel: **Add New → Project → import this repo**, then set

| Setting | Value |
| --- | --- |
| Root Directory | `pt-rehab-clinic/app` |
| Framework preset | Next.js (auto-detected) |
| Build / install command | leave as default |

`vercel.json` already pins the region to `sin1`, sets security headers, marks every
clinical route `no-store` and `noindex`, and registers the reminder cron.

## 3. Environment variables

Add these under **Settings → Environment Variables**. Never commit them.

| Variable | Scope | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | all | Safe to expose; RLS is what protects the data |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | all | Same |
| `SUPABASE_SERVICE_ROLE_KEY` | Production, Preview | **Bypasses RLS.** Server-only; never prefix it `NEXT_PUBLIC_` |
| `CRON_SECRET` | Production | Long random string. Vercel sends it as a bearer token on cron runs |
| `SEMAPHORE_API_KEY` | Production | SMS. Omit and reminders log instead of sending |
| `SEMAPHORE_SENDER_NAME` | Production | Registered sender ID |
| `RESEND_API_KEY` | Production | Email |
| `REMINDER_FROM_EMAIL` | Production | Verified sender address |
| `APP_TIMEZONE` | all | `Asia/Manila` |

Generate the cron secret with `openssl rand -base64 32`.

## 4. The reminder cron

`vercel.json` schedules `/api/cron/reminders` hourly. Vercel invokes it with `GET` and
attaches `Authorization: Bearer $CRON_SECRET` automatically once that variable is set —
the route accepts `GET` and `POST` and checks the bearer on both.

**Hobby plans allow one cron run per day.** On Hobby, change the schedule to `0 22 * * *`
(6 AM Manila) and accept that same-day reminders are drafted once each morning, or move
to Pro for the hourly run the spec assumes.

## 5. Check the deployment

Run these against the live URL before letting staff in:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-APP/            # 200 — public site
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-APP/dashboard   # 307 — redirects to /login
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-APP/api/cron/reminders  # 401 — no bearer
```

Then sign in and walk the nine points in `05-claude-build-spec.md` §17 by hand — that
path has been proven against the database but never clicked through a browser.

The single check worth doing twice: **sign in as Branch B front desk and try to open a
Branch A patient by pasting its URL.** You should get "not found", not a blank chart.

## Two things to keep straight

- **Rotate any credential that has been pasted into a chat, an issue, or a commit.**
  Deploy tokens and 2FA seeds are bearer credentials: whoever holds one is you.
- **Hosting in Singapore is a cross-border transfer** of Philippine health data. It is
  lawful under RA 10173, but the clinic remains accountable for it — raise it with your
  Data Protection Officer, and record it in your processing inventory.

## Deploying from a terminal instead

```bash
npm i -g vercel
cd pt-rehab-clinic/app
vercel link           # choose the project, confirm root directory
vercel env pull       # sanity-check what production has
vercel --prod
```
