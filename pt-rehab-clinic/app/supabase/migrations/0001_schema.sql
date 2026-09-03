-- 0001_schema.sql — core schema for Phase 1.
--
-- Design rule that shapes this file (spec §3, §4):
-- every core record carries clinic_id, and clinical free text is split into
-- companion tables (encounter_notes, program_body) so "front desk sees
-- metadata, not note bodies" is enforced by the schema rather than by a view
-- or a hidden button.

create extension if not exists pgcrypto;   -- gen_random_uuid(), digest()
create extension if not exists btree_gist; -- scalar = plus range && in one constraint

-- ---------------------------------------------------------------- enums ----

create type staff_role         as enum ('owner', 'admin', 'therapist');
create type discipline         as enum ('PT', 'OT', 'Speech', 'Psych', 'PO', 'MD');
create type payer_type         as enum ('philhealth', 'hmo', 'cash', 'referral');
create type case_type          as enum ('msk', 'neuro', 'pedia', 'other');
create type followup_rule      as enum ('every_6_sessions', 'monthly');
create type episode_status     as enum ('active', 'completed', 'discontinued');
create type encounter_kind     as enum ('md_consult', 'therapy_session', 'acupuncture');
create type encounter_status   as enum ('draft', 'final');
create type appointment_kind   as enum ('md_consult', 'therapy_session', 'acupuncture');
create type appointment_status as enum ('booked', 'completed', 'cancelled', 'no_show');
create type program_status     as enum ('draft', 'signed');
create type document_kind      as enum ('referral_back', 'referral_out', 'prescription');
create type document_status    as enum ('draft', 'signed', 'voided');
create type reminder_kind      as enum ('appointment', 'birthday', 'followup_due');
create type reminder_channel   as enum ('sms', 'email');
create type reminder_status    as enum ('queued', 'approved', 'sent', 'failed', 'skipped');
create type audit_action       as enum ('view', 'create', 'update', 'delete', 'print', 'export', 'send', 'sign');

-- --------------------------------------------------------------- tables ----

create table clinics (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  address        text,
  phone          text,
  letterhead_url text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table staff (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid unique,
  clinic_id       uuid not null references clinics(id),
  role            staff_role not null,
  full_name       text not null,
  discipline      discipline,
  prc_license_no  text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index staff_clinic_idx on staff(clinic_id);

create table rooms (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics(id),
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table referring_physicians (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id),
  full_name   text not null,
  clinic_name text,
  specialty   text,
  phone       text,
  email       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table patients (
  id                      uuid primary key default gen_random_uuid(),
  clinic_id               uuid not null references clinics(id),
  first_name              text not null,
  last_name               text not null,
  birth_date              date,
  sex                     text,
  phone                   text,
  email                   text,
  address                 text,
  payer_type              payer_type not null default 'cash',
  hmo_name                text,
  philhealth_no           text,
  referring_physician_id  uuid references referring_physicians(id),
  consent_signed_at       timestamptz,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index patients_clinic_idx on patients(clinic_id);
create index patients_birthday_idx on patients(extract(month from birth_date), extract(day from birth_date));

create table episodes (
  id                   uuid primary key default gen_random_uuid(),
  clinic_id            uuid not null references clinics(id),
  patient_id           uuid not null references patients(id) on delete cascade,
  diagnosis            text not null,
  icd10_code           text,
  case_type            case_type not null,
  followup_rule        followup_rule not null,
  started_on           date not null default current_date,
  ended_on             date,
  primary_therapist_id uuid references staff(id),
  status               episode_status not null default 'active',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index episodes_patient_idx on episodes(patient_id);

-- Encounters hold metadata only. SOAP text lives in encounter_notes so that
-- front desk can see that a consult happened without reading its contents.
create table encounters (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references clinics(id),
  patient_id   uuid not null references patients(id) on delete cascade,
  episode_id   uuid references episodes(id) on delete set null,
  kind         encounter_kind not null,
  provider_id  uuid references staff(id),
  occurred_at  timestamptz not null default now(),
  status       encounter_status not null default 'draft',
  finalized_at timestamptz,
  finalized_by uuid references staff(id),
  addendum_of  uuid references encounters(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index encounters_episode_idx on encounters(episode_id, kind, occurred_at);
create index encounters_patient_idx on encounters(patient_id);

create table encounter_notes (
  encounter_id    uuid primary key references encounters(id) on delete cascade,
  clinic_id       uuid not null references clinics(id),
  soap_subjective text,
  soap_objective  text,
  soap_assessment text,
  soap_plan       text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table appointments (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references clinics(id),
  patient_id   uuid not null references patients(id) on delete cascade,
  episode_id   uuid references episodes(id) on delete set null,
  provider_id  uuid not null references staff(id),
  room_id      uuid references rooms(id),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  kind         appointment_kind not null,
  status       appointment_status not null default 'booked',
  encounter_id uuid references encounters(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  during       tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  constraint appointments_ends_after_starts check (ends_at > starts_at)
);
create index appointments_clinic_time_idx on appointments(clinic_id, starts_at);

-- Double-booking is rejected by the database, not by application code:
-- two front-desk staff booking the same slot at the same moment both pass an
-- application-layer check and both write. An exclusion constraint does not
-- have that race.
alter table appointments add constraint appointments_no_provider_overlap
  exclude using gist (provider_id with =, during with &&)
  where (status in ('booked', 'completed'));

alter table appointments add constraint appointments_no_room_overlap
  exclude using gist (room_id with =, during with &&)
  where (status in ('booked', 'completed') and room_id is not null);

create table program_templates (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid references clinics(id), -- null = network-wide
  discipline discipline not null,
  name       text not null,
  body       jsonb not null default '{"items": []}'::jsonb,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table programs (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id),
  patient_id  uuid not null references patients(id) on delete cascade,
  episode_id  uuid references episodes(id) on delete set null,
  template_id uuid references program_templates(id),
  discipline  discipline not null,
  title       text not null,
  status      program_status not null default 'draft',
  signed_by   uuid references staff(id),
  signed_at   timestamptz,
  pdf_path    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table program_body (
  program_id uuid primary key references programs(id) on delete cascade,
  clinic_id  uuid not null references clinics(id),
  body       jsonb not null default '{"items": []}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table documents (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references clinics(id),
  patient_id   uuid not null references patients(id) on delete cascade,
  episode_id   uuid references episodes(id) on delete set null,
  kind         document_kind not null,
  title        text not null,
  body         jsonb not null default '{}'::jsonb,
  status       document_status not null default 'draft',
  signed_by    uuid references staff(id),
  signed_at    timestamptz,
  content_hash text,
  pdf_path     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index documents_patient_idx on documents(patient_id);

create table reminders (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid not null references clinics(id),
  patient_id          uuid not null references patients(id) on delete cascade,
  appointment_id      uuid references appointments(id) on delete cascade,
  episode_id          uuid references episodes(id) on delete set null,
  kind                reminder_kind not null,
  channel             reminder_channel not null,
  scheduled_for       timestamptz not null,
  draft_body          text not null,
  status              reminder_status not null default 'queued',
  approved_by         uuid references staff(id),
  approved_at         timestamptz,
  sent_at             timestamptz,
  provider_message_id text,
  error               text,
  dedupe_key          text not null unique,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index reminders_queue_idx on reminders(clinic_id, status, scheduled_for);

-- ------------------------------------------------------- updated_at ----

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'clinics','staff','rooms','referring_physicians','patients','episodes',
    'encounters','encounter_notes','appointments','program_templates',
    'programs','program_body','documents','reminders'
  ] loop
    execute format(
      'create trigger %I_set_updated_at before update on %I
         for each row execute function set_updated_at()', t, t);
  end loop;
end;
$$;
