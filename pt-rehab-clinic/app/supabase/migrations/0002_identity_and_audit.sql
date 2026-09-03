-- 0002_identity_and_audit.sql — who the caller is, and the append-only log.

-- Identity helpers. security definer so they can read `staff` regardless of the
-- caller's own policies; stable so the planner caches them per statement.
create or replace function current_staff_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from staff where auth_user_id = auth.uid() and is_active limit 1;
$$;

create or replace function current_clinic_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select clinic_id from staff where auth_user_id = auth.uid() and is_active limit 1;
$$;

create or replace function current_role_name() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select role::text from staff where auth_user_id = auth.uid() and is_active limit 1;
$$;

-- Read scope used by every SELECT policy: your own branch, or everything if
-- you are the owner. Writes never use this — see 0004_rls.sql.
create or replace function can_read_clinic(target uuid) returns boolean
language sql stable as $$
  select target = current_clinic_id() or current_role_name() = 'owner';
$$;

-- -------------------------------------------------------------- audit ----

create table audit_log (
  id             bigserial primary key,
  occurred_at    timestamptz not null default now(),
  actor_staff_id uuid references staff(id),
  actor_role     text,
  clinic_id      uuid references clinics(id),
  action         audit_action not null,
  entity_type    text not null,
  entity_id      uuid,
  patient_id     uuid,
  summary        text,
  ip             text,
  user_agent     text,
  before         jsonb,
  after          jsonb
);
create index audit_log_patient_idx on audit_log(patient_id, occurred_at desc);
create index audit_log_actor_idx   on audit_log(actor_staff_id, occurred_at desc);
create index audit_log_clinic_idx  on audit_log(clinic_id, occurred_at desc);

-- Writes are audited by trigger. Reads cannot be: Postgres has no SELECT
-- trigger, so chart views are logged explicitly by the data layer
-- (src/server/audit.ts). That asymmetry is why direct table reads of patient
-- data are banned outside src/server/ and checked in CI.
create or replace function audit_row_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_row    jsonb;
  v_action audit_action;
begin
  if tg_op = 'INSERT' then
    v_action := 'create'; v_after := to_jsonb(new); v_row := v_after;
  elsif tg_op = 'UPDATE' then
    v_action := 'update'; v_before := to_jsonb(old); v_after := to_jsonb(new); v_row := v_after;
  else
    v_action := 'delete'; v_before := to_jsonb(old); v_row := v_before;
  end if;

  -- A signature is materially different from an edit; label it as such so the
  -- log answers "who signed this prescription" without a diff.
  -- Read through the jsonb rows, not new.status: PL/pgSQL resolves record
  -- fields for the whole expression regardless of short-circuiting, so a
  -- direct new.status would break every table that has no status column.
  if tg_table_name in ('documents', 'programs')
     and tg_op = 'UPDATE'
     and v_after->>'status' = 'signed'
     and v_before->>'status' is distinct from 'signed' then
    v_action := 'sign';
  end if;

  insert into audit_log (
    actor_staff_id, actor_role, clinic_id, action,
    entity_type, entity_id, patient_id, before, after
  ) values (
    current_staff_id(),
    current_role_name(),
    nullif(v_row->>'clinic_id', '')::uuid,
    v_action,
    tg_table_name,
    coalesce(
      nullif(v_row->>'id', ''),
      nullif(v_row->>'encounter_id', ''),
      nullif(v_row->>'program_id', '')
    )::uuid,
    -- The patients table has no patient_id column: its own id is the subject.
    -- Without this, "everything that happened to this patient" would omit
    -- their registration and every demographic edit.
    coalesce(
      nullif(v_row->>'patient_id', ''),
      case when tg_table_name = 'patients' then nullif(v_row->>'id', '') end
    )::uuid,
    v_before,
    v_after
  );
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'patients','episodes','encounters','encounter_notes','appointments',
    'programs','program_body','documents','reminders','staff','rooms',
    'referring_physicians'
  ] loop
    execute format(
      'create trigger %I_audit after insert or update or delete on %I
         for each row execute function audit_row_change()', t, t);
  end loop;
end;
$$;
