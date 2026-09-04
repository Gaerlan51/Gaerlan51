# Launch runbook

Four commands and two dashboards. The app lives in a subdirectory of this
repository, so the one setting people get wrong is **Root Directory** — set it to
`pt-rehab-clinic/app` or Vercel finds no Next.js project.

```bash
cd pt-rehab-clinic/app
DATABASE_URL=…  npm run db:bootstrap -- --seed   # schema + branches into Supabase
DATABASE_URL=…  npm run staff:link -- --dry-run  # check who will get an account
DATABASE_URL=…  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=…  npm run staff:link
npm run preflight -- https://your-app.vercel.app # refuse to launch if anything leaks
```

## You do not need a deploy token

Connect the repository through **Vercel → Add New → Project → Import Git Repository**.
Vercel's GitHub integration handles authentication itself, so no token is created,
pasted, or stored anywhere. A personal deploy token is a bearer credential — whoever
holds it is you — and it is worth avoiding when the integration does the same job.

If a token ever does get pasted into a chat, an issue, or a commit: rotate it. It is
compromised the moment it is written down somewhere that is not a secret store.

## 1. Supabase

The public site deploys and works with no database at all. Everything behind `/login`
does not, so do this first.

1. Create a project in the **Singapore (`ap-southeast-1`)** region — nearest to Manila.
2. Apply the schema. From **Project Settings → Database → Connection string**:
   ```bash
   DATABASE_URL='postgresql://postgres:…@db.….supabase.co:5432/postgres' \
     npm run db:bootstrap -- --seed
   ```
   Safe to re-run: every migration is recorded in `schema_migrations` and skipped
   afterwards. It refuses a database that is not a Supabase project, and refuses to
   run a migration whose contents changed after it was applied.
3. Replace the placeholders the seed wrote — branch names, addresses, phone numbers,
   the doctor's name and PRC licence number, and **staff email addresses**:
   ```sql
   update staff set email = 'maria.santos@yourclinic.ph' where full_name = '…';
   ```
4. Create the Auth accounts and link them:
   ```bash
   DATABASE_URL=… npm run staff:link -- --dry-run     # lists who, creates nothing
   DATABASE_URL=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run staff:link
   ```
   Generated passwords print **once**. Hand them over in person and have each person
   change theirs at first sign-in — anyone holding one can open that branch's records.
   The dry run refuses to proceed while any address is still `@example.ph`, because an
   account created against a placeholder can never receive a password reset.

Nobody can sign in until step 4 completes. That is deliberate: `current_staff_id()`
resolves through `staff.auth_user_id`, so an unlinked account has no branch, no role,
and no access to anything.

## 2. Vercel

| Setting | Value |
| --- | --- |
| Root Directory | `pt-rehab-clinic/app` |
| Framework preset | Next.js (auto-detected) |
| Build / install command | leave as default |

`vercel.json` pins the region to `sin1`, registers the reminder cron, sets security
headers, and marks clinical and API routes `no-store` and `noindex` — so a chart never
lands in a shared cache or a search index.

## 3. Environment variables

**Settings → Environment Variables.** Never commit these.

| Variable | Scope | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | all | Safe to expose; RLS is what protects the data |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | all | Same |
| `SUPABASE_SERVICE_ROLE_KEY` | Production, Preview | **Bypasses RLS.** Server-only; never prefix it `NEXT_PUBLIC_` |
| `CRON_SECRET` | Production | `openssl rand -base64 32`. Vercel sends it as a bearer on cron runs |
| `SEMAPHORE_API_KEY` | Production | SMS. Omit and reminders log instead of sending |
| `SEMAPHORE_SENDER_NAME` | Production | Registered sender ID |
| `RESEND_API_KEY` | Production | Email |
| `REMINDER_FROM_EMAIL` | Production | Verified sender address |
| `APP_TIMEZONE` | all | `Asia/Manila` |

A deployment without the Supabase values still serves the public site; sign-in says it
has no database rather than erroring.

## 4. The reminder cron

`vercel.json` schedules `/api/cron/reminders` hourly. Vercel invokes it with `GET` and
attaches `Authorization: Bearer $CRON_SECRET` automatically once that variable is set;
the route accepts `GET` and `POST` and checks the bearer on both.

**Hobby plans allow one cron run per day.** On Hobby, change the schedule to
`0 22 * * *` (6 AM Manila) and accept that reminders are drafted once each morning, or
move to Pro for the hourly run the spec assumes.

## 5. Preflight

```bash
npm run preflight -- https://your-app.vercel.app
```

Eleven required checks: the public site answers, every clinical route refuses an
anonymous request, the CSV export refuses one, and the cron endpoint rejects both a
missing and a wrong token. Header checks are warnings, since `vercel.json` only applies
them in production. **Non-zero exit means do not let staff in.**

Then walk the nine points in `../05-claude-build-spec.md` §17 by hand. That path is
proven against the database but has never been clicked through a browser.

The single check worth doing twice: **sign in as Branch B front desk and paste the URL
of a Branch A patient.** You should get "not found", never a chart.

## Two things to keep straight

- **Rotate any credential that has been pasted anywhere it can be read again.**
- **Hosting in Singapore is a cross-border transfer** of Philippine health data. Lawful
  under RA 10173, but the clinic remains accountable — raise it with your Data
  Protection Officer and record it in your processing inventory.
