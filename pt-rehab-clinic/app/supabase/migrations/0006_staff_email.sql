-- 0006_staff_email.sql — the join between Supabase Auth and the staff table.
--
-- Until now staff rows were linked to auth.users by hand. An email column
-- gives the two sides a natural key, so `npm run staff:link` can create the
-- Auth user and connect it without anyone copying UUIDs between tabs.
--
-- Nullable: a staff record can exist before the person has an account, which
-- is the normal order of events when a branch hires someone.

alter table staff add column if not exists email text;

-- Case-insensitive: email addresses are not case-sensitive in practice, and a
-- duplicate here would mean two staff rows fighting over one login.
create unique index if not exists staff_email_key on staff (lower(email));

comment on column staff.email is
  'Work email. Matches auth.users.email; used by scripts/staff-link.mjs to '
  'connect a staff record to its Auth account.';
