-- seed.sql — development and demo data.
--
-- Branch names, letterhead and the doctor's PRC licence number are
-- PLACEHOLDERS (spec §14): the owner supplies the real ones. The programme
-- template library is deliberately EMPTY (spec §15) — clinical content is the
-- doctor's to provide, not the builder's to invent.
--
-- Staff rows here have no auth_user_id: create the Supabase Auth users first,
-- then set staff.auth_user_id to match. Nobody can sign in until you do.

insert into clinics (id, name, address, phone) values
  ('11111111-1111-1111-1111-111111111101', 'Branch 1 — [name to confirm]', '[address]', '[phone]'),
  ('11111111-1111-1111-1111-111111111102', 'Branch 2 — [name to confirm]', '[address]', '[phone]'),
  ('11111111-1111-1111-1111-111111111103', 'Branch 3 — [name to confirm]', '[address]', '[phone]'),
  ('11111111-1111-1111-1111-111111111104', 'Branch 4 — [name to confirm]', '[address]', '[phone]'),
  ('11111111-1111-1111-1111-111111111105', 'Branch 5 — [name to confirm]', '[address]', '[phone]')
on conflict (id) do nothing;

-- Two therapists and two rooms per branch, per the spec §15 default.
do $$
declare c record; i int; n int := 0;
begin
  for c in select id, name from clinics order by name loop
    n := n + 1;
    for i in 1..2 loop
      insert into rooms (clinic_id, name) values (c.id, 'Therapy Room ' || i);
    end loop;
    i := n;
    -- Emails are placeholders: replace them with real work addresses before
    -- running `npm run staff:link`, which creates an Auth account per address.
    insert into staff (clinic_id, role, full_name, discipline, email) values
      (c.id, 'admin', 'Front Desk — ' || c.name, null,
       'frontdesk.' || i || '@example.ph'),
      (c.id, 'therapist', 'PT Therapist — ' || c.name, 'PT',
       'pt.' || i || '@example.ph'),
      (c.id, 'therapist', 'OT Therapist — ' || c.name, 'OT',
       'ot.' || i || '@example.ph');
  end loop;
end;
$$;

-- The owner-doctor is based at Branch 1 and reads across all five.
insert into staff (clinic_id, role, full_name, discipline, prc_license_no, email)
values ('11111111-1111-1111-1111-111111111101', 'owner',
        'Dr. [owner name to confirm]', 'MD', '[PRC licence no. to confirm]',
        'owner@example.ph');

-- Programme templates: intentionally none. See spec §15.
