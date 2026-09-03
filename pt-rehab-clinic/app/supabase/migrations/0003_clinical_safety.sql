-- 0003_clinical_safety.sql — spec §7 and §9, enforced in the database.
--
-- Everything here exists because "the UI won't let them" is not a control.
-- These are the rules that must hold even if a bug, a script, or a future
-- developer talks to the tables directly.

-- --------------------------------------------- finalized notes are locked ----

create or replace function encounters_guard_status() returns trigger
language plpgsql as $$
begin
  if old.status = 'final' and new.status = 'draft' then
    raise exception 'A finalized encounter cannot be reopened. File an addendum instead.'
      using errcode = 'check_violation';
  end if;
  if new.status = 'final' and old.status = 'draft' then
    new.finalized_at := now();
    new.finalized_by := current_staff_id();
  end if;
  return new;
end;
$$;

create trigger encounters_guard_status
  before update on encounters
  for each row execute function encounters_guard_status();

create or replace function encounter_notes_guard_locked() returns trigger
language plpgsql as $$
declare v_status encounter_status;
begin
  select status into v_status from encounters where id = new.encounter_id;
  if v_status = 'final' then
    raise exception 'SOAP fields are locked once the encounter is finalized. File an addendum instead.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger encounter_notes_guard_locked
  before insert or update on encounter_notes
  for each row execute function encounter_notes_guard_locked();

-- ------------------------------------------------------- document signing ----

-- The prescription safety mechanism (spec §9). Three properties:
--   1. Documents are born as drafts. Nothing can insert a signed one.
--   2. Only the owner/doctor role can sign, enforced here as well as in RLS.
--   3. Signing hashes the body; editing a signed body reverts it to draft, so
--      a signed PDF can never disagree with the record it was signed from.
create or replace function documents_guard_signing() returns trigger
language plpgsql as $$
declare v_hash text;
begin
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.signed_by := null;
    new.signed_at := null;
    new.content_hash := null;
    return new;
  end if;

  v_hash := encode(digest(new.body::text, 'sha256'), 'hex');

  -- Body edited out from under a signature -> back to draft.
  if old.status = 'signed'
     and new.status = 'signed'
     and v_hash is distinct from old.content_hash then
    new.status := 'draft';
    new.signed_by := null;
    new.signed_at := null;
    new.content_hash := null;
    return new;
  end if;

  if new.status = 'signed' and old.status is distinct from 'signed' then
    if current_role_name() is distinct from 'owner' then
      raise exception 'Only the owner/doctor role may sign a document.'
        using errcode = 'insufficient_privilege';
    end if;
    new.signed_by := current_staff_id();
    new.signed_at := now();
    new.content_hash := v_hash;
  end if;

  return new;
end;
$$;

create trigger documents_guard_signing
  before insert or update on documents
  for each row execute function documents_guard_signing();

-- ------------------------------------------------------- program signing ----

create or replace function programs_guard_signing() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.signed_by := null;
    new.signed_at := null;
    return new;
  end if;

  if new.status = 'signed' and old.status is distinct from 'signed' then
    if current_role_name() is distinct from 'owner' then
      raise exception 'Only the owner/doctor role may sign a therapy program.'
        using errcode = 'insufficient_privilege';
    end if;
    new.signed_by := current_staff_id();
    new.signed_at := now();
  end if;

  return new;
end;
$$;

create trigger programs_guard_signing
  before insert or update on programs
  for each row execute function programs_guard_signing();

-- Editing a signed program's body reverts it to draft, same reasoning as
-- documents above.
create or replace function program_body_guard_signed() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.body::text is distinct from old.body::text then
    update programs set status = 'draft', signed_by = null, signed_at = null
      where id = new.program_id and status = 'signed';
  end if;
  return new;
end;
$$;

create trigger program_body_guard_signed
  before update on program_body
  for each row execute function program_body_guard_signed();
