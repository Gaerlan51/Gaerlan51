-- Local-only stand-in for the pieces of Supabase's `auth` schema that the
-- migrations depend on. NOT a migration: hosted Supabase already provides it.
-- It exists so RLS can be exercised for real against a local Postgres.
-- Hosted Supabase ships these roles; a bare Postgres cluster does not.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key,
  email text unique
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
