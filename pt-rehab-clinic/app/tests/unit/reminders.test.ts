import { describe, it, expect } from 'vitest';
import {
  draftAppointmentReminder, draftBirthdayGreeting, draftFollowupDue,
  dedupeKey, appointmentWindow, preferredChannel, manilaDay,
} from '@/domain/reminders';
import { planReminders, isBirthdayToday } from '@/domain/reminder-plan';

const clinic = { clinicName: 'Rehab Center Alpha', clinicPhone: '(02) 8555-0101' };

describe('message drafting (spec §10)', () => {
  it('opens with Filipino courtesy phrasing and names the patient', () => {
    const body = draftAppointmentReminder({
      ...clinic, patientFirstName: 'Ana', when: new Date('2026-03-02T09:00:00+08:00'),
    });
    expect(body).toMatch(/^Magandang araw po, Ana!/);
    expect(body).toContain('Rehab Center Alpha');
    expect(body).toContain('(02) 8555-0101');
  });

  it('offers a Tagalog variant', () => {
    const tl = draftAppointmentReminder({ ...clinic, patientFirstName: 'Ana' }, 'tl');
    expect(tl).toContain('Paalala po sa inyong appointment');
  });

  it('formats the appointment time in Manila regardless of server timezone', () => {
    const body = draftAppointmentReminder({
      ...clinic, patientFirstName: 'Ana', when: new Date('2026-03-02T01:00:00Z'),
    });
    expect(body).toMatch(/9:00\s?AM/i); // 01:00 UTC is 09:00 in Manila
  });

  it('never carries clinical content — the builders cannot receive any', () => {
    const bodies = [
      draftAppointmentReminder({ ...clinic, patientFirstName: 'Ana' }),
      draftBirthdayGreeting({ ...clinic, patientFirstName: 'Ana' }),
      draftFollowupDue({ ...clinic, patientFirstName: 'Ana' }),
    ];
    for (const body of bodies) {
      expect(body).not.toMatch(/diagnos|lumbar|stroke|assessment|SOAP/i);
    }
  });

  it('a follow-up message invites a booking without stating why', () => {
    const body = draftFollowupDue({ ...clinic, patientFirstName: 'Ana' });
    expect(body).toContain('follow-up check-up');
    expect(body).not.toMatch(/6 sessions|due|overdue/i);
  });
});

describe('queue mechanics', () => {
  it('dedupes per patient, kind, channel and Manila day', () => {
    const morning = new Date('2026-03-02T01:00:00Z'); // 09:00 Manila
    const evening = new Date('2026-03-02T13:00:00Z'); // 21:00 Manila, same day
    expect(dedupeKey('birthday', 'sms', 'p1', morning))
      .toBe(dedupeKey('birthday', 'sms', 'p1', evening));
    expect(dedupeKey('birthday', 'sms', 'p1', morning))
      .not.toBe(dedupeKey('birthday', 'email', 'p1', morning));
  });

  it('rolls the day over at Manila midnight, not UTC midnight', () => {
    expect(manilaDay(new Date('2026-03-02T16:30:00Z'))).toBe('2026-03-03');
  });

  it('targets appointments 24-48h out', () => {
    const now = new Date('2026-03-01T00:00:00Z');
    const { from, to } = appointmentWindow(now);
    expect(from.toISOString()).toBe('2026-03-02T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-03-03T00:00:00.000Z');
  });

  it('prefers SMS, falls back to email, and skips patients with neither', () => {
    expect(preferredChannel({ phone: '+639170000001', email: 'a@b.c' })).toBe('sms');
    expect(preferredChannel({ phone: null, email: 'a@b.c' })).toBe('email');
    expect(preferredChannel({ phone: null, email: null })).toBeNull();
  });
});

describe('planning (spec §10)', () => {
  const now = new Date('2026-03-01T02:00:00Z'); // 10:00 Manila
  const patient = {
    id: 'p1', clinic_id: 'c1', first_name: 'Ana',
    phone: '+639170000001', email: null, birth_date: '1980-03-01',
  };
  const base = { now, clinicNames: { c1: 'Rehab Center Alpha' }, patients: [patient] };

  it('drafts a reminder for an appointment inside the window and skips one outside it', () => {
    const planned = planReminders({
      ...base,
      appointments: [
        { id: 'a1', clinic_id: 'c1', patient_id: 'p1', starts_at: '2026-03-02T02:00:00Z' },
        { id: 'a2', clinic_id: 'c1', patient_id: 'p1', starts_at: '2026-03-05T02:00:00Z' },
      ],
      followups: [],
    });
    const appointmentReminders = planned.filter((r) => r.kind === 'appointment');
    expect(appointmentReminders).toHaveLength(1);
    expect(appointmentReminders[0].appointment_id).toBe('a1');
  });

  it('recognises a birthday by month and day, ignoring the year', () => {
    expect(isBirthdayToday('1980-03-01', now)).toBe(true);
    expect(isBirthdayToday('1980-03-02', now)).toBe(false);
    expect(isBirthdayToday(null, now)).toBe(false);
  });

  it('drafts a follow-up reminder only for episodes that are due', () => {
    const planned = planReminders({
      ...base,
      appointments: [],
      followups: [
        { episode_id: 'e1', clinic_id: 'c1', patient_id: 'p1', is_due: true },
        { episode_id: 'e2', clinic_id: 'c1', patient_id: 'p1', is_due: false },
      ],
    });
    const followupReminders = planned.filter((r) => r.kind === 'followup_due');
    expect(followupReminders).toHaveLength(1);
    expect(followupReminders[0].episode_id).toBe('e1');
  });

  it('skips patients with no contact details', () => {
    const planned = planReminders({
      ...base,
      patients: [{ ...patient, phone: null, email: null }],
      appointments: [{ id: 'a1', clinic_id: 'c1', patient_id: 'p1', starts_at: '2026-03-02T02:00:00Z' }],
      followups: [],
    });
    expect(planned).toHaveLength(0);
  });

  it('produces no duplicates when run twice in the same day', () => {
    const input = {
      ...base, appointments: [], followups: [
        { episode_id: 'e1', clinic_id: 'c1', patient_id: 'p1', is_due: true },
      ],
    };
    const keyOf = (rs: ReturnType<typeof planReminders>) =>
      rs.find((r) => r.kind === 'followup_due')!.dedupe_key;
    const first = planReminders(input);
    const second = planReminders({ ...input, now: new Date('2026-03-01T09:00:00Z') });
    expect(keyOf(first)).toBe(keyOf(second));
  });
});
