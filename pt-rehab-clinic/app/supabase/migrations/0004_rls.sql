-- 0004_rls.sql — branch isolation (spec §5).
--
-- Every table in public has RLS enabled; none is left open. The shape is:
--   SELECT  -> can_read_clinic(clinic_id)   (own branch, or anything if owner)
--   WRITE   -> clinic_id = current_clinic_id()  (owner's cross-branch access
--              is read-only, so there is deliberately no owner exception here)
-- layered with role restrictions from spec §3.

-- Mirror Supabase's roles so this file applies unchanged locally and hosted.
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

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Phase 1 is staff-only: there is no patient portal and no anonymous surface.
revoke all on all tables in schema public from anon;

-- The audit log is append-only. Both halves matter: no UPDATE/DELETE policy
-- exists below, and the privilege itself is revoked.
revoke update, delete on audit_log from authenticated;

-- "Assigned patient" for a therapist, per spec §3. Wrapped in a security
-- definer function so the policies that call it do not re-enter RLS on
-- episodes/appointments and recurse.
create or replace function is_assigned_patient(p_patient_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from episodes e
      where e.patient_id = p_patient_id and e.primary_therapist_id = current_staff_id()
    union all
    select 1 from appointments a
      where a.patient_id = p_patient_id and a.provider_id = current_staff_id()
    union all
    select 1 from encounters en
      where en.patient_id = p_patient_id and en.provider_id = current_staff_id()
  );
$$;

-- Convenience: may the caller reach this patient's chart at all?
create or replace function can_read_patient(p_patient_id uuid, p_clinic_id uuid)
returns boolean language sql stable as $$
  select can_read_clinic(p_clinic_id)
     and (current_role_name() in ('owner', 'admin') or is_assigned_patient(p_patient_id));
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'clinics','staff','rooms','referring_physicians','patients','episodes',
    'encounters','encounter_notes','appointments','program_templates',
    'programs','program_body','documents','reminders','audit_log'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end;
$$;

-- ------------------------------------------------------------- clinics ----
create policy clinics_select on clinics for select to authenticated
  using (can_read_clinic(id));
create policy clinics_update on clinics for update to authenticated
  using (id = current_clinic_id() and current_role_name() = 'owner')
  with check (id = current_clinic_id());

-- --------------------------------------------------------------- staff ----
create policy staff_select on staff for select to authenticated
  using (can_read_clinic(clinic_id));
create policy staff_write on staff for all to authenticated
  using (clinic_id = current_clinic_id() and current_role_name() = 'owner')
  with check (clinic_id = current_clinic_id() and current_role_name() = 'owner');

-- --------------------------------------------------------------- rooms ----
create policy rooms_select on rooms for select to authenticated
  using (can_read_clinic(clinic_id));
create policy rooms_write on rooms for all to authenticated
  using (clinic_id = current_clinic_id() and current_role_name() in ('owner','admin'))
  with check (clinic_id = current_clinic_id() and current_role_name() in ('owner','admin'));

-- -------------------------------------------------- referring physicians ----
create policy refphys_select on referring_physicians for select to authenticated
  using (can_read_clinic(clinic_id));
create policy refphys_write on referring_physicians for all to authenticated
  using (clinic_id = current_clinic_id() and current_role_name() in ('owner','admin'))
  with check (clinic_id = current_clinic_id() and current_role_name() in ('owner','admin'));

-- ------------------------------------------------------------ patients ----
create policy patients_select on patients for select to authenticated
  using (can_read_patient(id, clinic_id));
create policy patients_insert on patients for insert to authenticated
  with check (clinic_id = current_clinic_id() and current_role_name() in ('owner','admin'));
create policy patients_update on patients for update to authenticated
  using (clinic_id = current_clinic_id() and current_role_name() in ('owner','admin'))
  with check (clinic_id = current_clinic_id());
create policy patients_delete on patients for delete to authenticated
  using (clinic_id = current_clinic_id() and current_role_name() = 'owner');

-- ------------------------------------------------------------ episodes ----
create policy episodes_select on episodes for select to authenticated
  using (can_read_patient(patient_id, clinic_id));
create policy episodes_write on episodes for all to authenticated
  using (clinic_id = current_clinic_id() and current_role_name() in ('owner','admin'))
  with check (clinic_id = current_clinic_id() and current_role_name() in ('owner','admin'));

-- ---------------------------------------------------------- encounters ----
-- Front desk sees that a consult happened (metadata) but not what it said;
-- the SOAP text lives in encounter_notes below.
create policy encounters_select on encounters for select to authenticated
  using (can_read_patient(patient_id, clinic_id));
create policy encounters_insert on encounters for insert to authenticated
  with check (clinic_id = current_clinic_id() and current_role_name() in ('owner','therapist'));
create policy encounters_update on encounters for update to authenticated
  using (clinic_id = current_clinic_id()
         and (current_role_name() = 'owner' or provider_id = current_staff_id()))
  with check (clinic_id = current_clinic_id());
create policy encounters_delete on encounters for delete to authenticated
  using (clinic_id = current_clinic_id() and current_role_name() = 'owner');

-- ----------------------------------------------------- encounter notes ----
create policy encounter_notes_select on encounter_notes for select to authenticated
  using (can_read_clinic(clinic_id) and current_role_name() in ('owner','therapist'));
create policy encounter_notes_write on encounter_notes for all to authenticated
  using (clinic_id = current_clinic_id() and current_role_name() in ('owner','therapist'))
  with check (clinic_id = current_clinic_id() and current_role_name() in ('owner','therapist'));

-- -------------------------------------------------------- appointments ----
create policy appointments_select on appointments for select to authenticated
  using (can_read_patient(patient_id, clinic_id) or provider_id = current_staff_id());
create policy appointments_insert on appointments for insert to authenticated
  with check (clinic_id = current_clinic_id() and current_role_name() in ('owner','admin'));
create policy appointments_update on appointments for update to authenticated
  using (clinic_id = current_clinic_id()
         and (current_role_name() in ('owner','admin') or provider_id = current_staff_id()))
  with check (clinic_id = current_clinic_id());
create policy appointments_delete on appointments for delete to authenticated
  using (clinic_id = current_clinic_id() and current_role_name() in ('owner','admin'));

-- ---------------------------------------------------- program templates ----
create policy program_templates_select on program_templates for select to authenticated
  using (clinic_id is null or can_read_clinic(clinic_id));
create policy program_templates_write on program_templates for all to authenticated
  using (clinic_id = current_clinic_id() and current_role_name() = 'owner')
  with check (clinic_id = current_clinic_id() and current_role_name() = 'owner');

-- ------------------------------------------------------------ programs ----
create policy programs_select on programs for select to authenticated
  using (can_read_patient(patient_id, clinic_id));
create policy programs_insert on programs for insert to authenticated
  with check (clinic_id = current_clinic_id() and current_role_name() in ('owner','therapist'));
-- with check keeps a non-owner from writing status='signed'; the trigger in
-- 0003 raises as well. Two mechanisms, because this one matters.
create policy programs_update on programs for update to authenticated
  using (clinic_id = current_clinic_id() and current_role_name() in ('owner','therapist'))
  with check (clinic_id = current_clinic_id()
              and (current_role_name() = 'owner' or status <> 'signed'));

create policy program_body_select on program_body for select to authenticated
  using (can_read_clinic(clinic_id) and current_role_name() in ('owner','therapist'));
create policy program_body_write on program_body for all to authenticated
  using (clinic_id = current_clinic_id() and current_role_name() in ('owner','therapist'))
  with check (clinic_id = current_clinic_id() and current_role_name() in ('owner','therapist'));

-- ----------------------------------------------------------- documents ----
-- Front desk can read and print referral letters and prescriptions — that is
-- their job — and every print writes an audit entry. Only the owner can sign.
create policy documents_select on documents for select to authenticated
  using (can_read_clinic(clinic_id));
create policy documents_insert on documents for insert to authenticated
  with check (clinic_id = current_clinic_id() and current_role_name() in ('owner','admin'));
create policy documents_update on documents for update to authenticated
  using (clinic_id = current_clinic_id() and current_role_name() in ('owner','admin'))
  with check (clinic_id = current_clinic_id()
              and (current_role_name() = 'owner' or status <> 'signed'));
create policy documents_delete on documents for delete to authenticated
  using (clinic_id = current_clinic_id() and current_role_name() = 'owner');

-- ----------------------------------------------------------- reminders ----
create policy reminders_select on reminders for select to authenticated
  using (can_read_clinic(clinic_id));
create policy reminders_write on reminders for all to authenticated
  using (clinic_id = current_clinic_id() and current_role_name() in ('owner','admin'))
  with check (clinic_id = current_clinic_id() and current_role_name() in ('owner','admin'));

-- ----------------------------------------------------------- audit log ----
-- Insert and select only. No UPDATE or DELETE policy exists, by design.
create policy audit_log_insert on audit_log for insert to authenticated
  with check (can_read_clinic(clinic_id));
create policy audit_log_select on audit_log for select to authenticated
  using (current_role_name() = 'owner'
         or (current_role_name() = 'admin' and clinic_id = current_clinic_id()));
