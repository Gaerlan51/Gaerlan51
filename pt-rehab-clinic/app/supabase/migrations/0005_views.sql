-- 0005_views.sql — the follow-up rule (spec §8) and dashboard aggregates.
--
-- The rule is defined exactly once, here. The chart banner, the worklist, the
-- reminder generator and the Owner Dashboard all read this view, so the four
-- of them cannot drift into four subtly different rules.
--
-- security_invoker = on: the view runs with the caller's own RLS, so branch
-- staff see their branch, the owner sees all five, and the reminder cron
-- (service_role, bypassrls) sees everything. No second scoped copy needed.

create view v_followup_due with (security_invoker = on) as
with anchors as (
  select
    e.id            as episode_id,
    e.clinic_id,
    e.patient_id,
    e.followup_rule,
    e.case_type,
    e.diagnosis,
    -- Anchor: the most recent finalized MD consult for the episode, falling
    -- back to the episode start when there has not been one yet.
    coalesce(
      (select max(en.occurred_at)
         from encounters en
        where en.episode_id = e.id
          and en.kind = 'md_consult'
          and en.status = 'final'),
      e.started_on::timestamptz
    ) as anchor
  from episodes e
  where e.status = 'active'
),
counted as (
  select
    a.*,
    (select count(*)
       from encounters s
      where s.episode_id = a.episode_id
        and s.kind = 'therapy_session'
        and s.occurred_at > a.anchor)::int as sessions_since_anchor
  from anchors a
)
select
  c.episode_id,
  c.clinic_id,
  c.patient_id,
  c.followup_rule,
  c.case_type,
  c.diagnosis,
  c.anchor,
  c.sessions_since_anchor,
  floor(extract(epoch from (now() - c.anchor)) / 86400)::int as days_since_anchor,
  case c.followup_rule
    when 'every_6_sessions' then c.sessions_since_anchor >= 6
    when 'monthly'          then now() - c.anchor >= interval '1 month'
  end as is_due
from counted c;

grant select on v_followup_due to authenticated, service_role;

-- ----------------------------------------------------- dashboard (§11) ----
-- A plain SQL function, so it runs security invoker and RLS decides what the
-- caller can count: branch staff get their branch, the owner gets all five.
-- Claims and cash are Phase 2 and are deliberately absent rather than zero.
create or replace function dashboard_stats(p_from timestamptz, p_to timestamptz)
returns table (
  clinic_id        uuid,
  clinic_name      text,
  consultations    int,
  therapy_sessions int,
  active_patients  int,
  new_patients     int,
  followups_due    int,
  no_shows         int,
  appointments     int
)
language sql stable as $$
  select
    c.id,
    c.name,
    (select count(*)::int from encounters e
       where e.clinic_id = c.id and e.kind = 'md_consult'
         and e.occurred_at >= p_from and e.occurred_at < p_to),
    (select count(*)::int from encounters e
       where e.clinic_id = c.id and e.kind = 'therapy_session'
         and e.occurred_at >= p_from and e.occurred_at < p_to),
    (select count(distinct ep.patient_id)::int from episodes ep
       where ep.clinic_id = c.id and ep.status = 'active'),
    (select count(*)::int from patients p
       where p.clinic_id = c.id
         and p.created_at >= p_from and p.created_at < p_to),
    (select count(*)::int from v_followup_due f
       where f.clinic_id = c.id and f.is_due),
    (select count(*)::int from appointments a
       where a.clinic_id = c.id and a.status = 'no_show'
         and a.starts_at >= p_from and a.starts_at < p_to),
    (select count(*)::int from appointments a
       where a.clinic_id = c.id
         and a.starts_at >= p_from and a.starts_at < p_to)
  from clinics c
  where c.is_active
  order by c.name;
$$;

grant execute on function dashboard_stats(timestamptz, timestamptz) to authenticated, service_role;
