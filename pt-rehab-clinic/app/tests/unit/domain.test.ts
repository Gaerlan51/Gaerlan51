import { describe, it, expect } from 'vitest';
import { followupLabel, ruleExplanation, sortByUrgency, defaultFollowupRule } from '@/domain/followup';
import { describeWriteError, assertAffected } from '@/domain/conflicts';
import { toCsv } from '@/domain/csv';
import { periodRange } from '@/domain/period';
import type { FollowupRow } from '@/lib/types';

const row = (over: Partial<FollowupRow> = {}): FollowupRow => ({
  episode_id: 'e1', clinic_id: 'c1', patient_id: 'p1', followup_rule: 'every_6_sessions',
  case_type: 'msk', diagnosis: 'Lumbar radiculopathy', anchor: '2026-01-01T00:00:00Z',
  sessions_since_anchor: 0, days_since_anchor: 0, is_due: false, ...over,
});

describe('follow-up presentation', () => {
  it('counts down sessions, then states the case is due', () => {
    expect(followupLabel(row({ sessions_since_anchor: 4 }))).toBe('2 sessions until MD review');
    expect(followupLabel(row({ sessions_since_anchor: 5 }))).toBe('1 session until MD review');
    expect(followupLabel(row({ sessions_since_anchor: 6, is_due: true })))
      .toBe('Due for MD follow-up — 6 sessions since last review');
  });

  it('describes pedia cases by elapsed days', () => {
    const pedia = row({ followup_rule: 'monthly', case_type: 'pedia', days_since_anchor: 31, is_due: true });
    expect(followupLabel(pedia)).toBe('Due for MD follow-up — 31 days since last review');
    expect(ruleExplanation(pedia)).toMatch(/monthly/i);
  });

  it('puts due cases first, most overdue at the top', () => {
    const sorted = sortByUrgency([
      row({ episode_id: 'a', sessions_since_anchor: 2 }),
      row({ episode_id: 'b', sessions_since_anchor: 9, is_due: true }),
      row({ episode_id: 'c', sessions_since_anchor: 6, is_due: true }),
    ]);
    expect(sorted.map((r) => r.episode_id)).toEqual(['b', 'c', 'a']);
  });

  it('defaults the rule from the case type', () => {
    expect(defaultFollowupRule('pedia')).toBe('monthly');
    expect(defaultFollowupRule('msk')).toBe('every_6_sessions');
    expect(defaultFollowupRule('neuro')).toBe('every_6_sessions');
    expect(defaultFollowupRule('other')).toBe('every_6_sessions');
  });
});

describe('database refusals become readable', () => {
  it('explains a therapist double-booking', () => {
    expect(describeWriteError({ code: '23P01', constraint: 'appointments_no_provider_overlap' }))
      .toMatch(/therapist already has an appointment/i);
  });

  it('explains a room clash', () => {
    expect(describeWriteError({ code: '23P01', constraint: 'appointments_no_room_overlap' }))
      .toMatch(/room is already booked/i);
  });

  it('explains a refused signature', () => {
    expect(describeWriteError({ message: 'Only the owner/doctor role may sign a document.' }))
      .toMatch(/only the doctor can sign/i);
  });

  it('explains a locked note', () => {
    expect(describeWriteError({ message: 'SOAP fields are locked once the encounter is finalized.' }))
      .toMatch(/finalized and cannot be edited/i);
  });

  it('treats a zero-row update as a refusal, not a success', () => {
    expect(() => assertAffected(0, 'The patient record')).toThrow(/outside your branch/i);
    expect(() => assertAffected(null, 'The patient record')).toThrow();
    expect(() => assertAffected(1, 'The patient record')).not.toThrow();
  });
});

describe('CSV export', () => {
  it('quotes separators, quotes and newlines', () => {
    const csv = toCsv([{ name: 'Reyes, Ana', note: 'said "ok"', address: 'line1\nline2' }]);
    expect(csv).toBe('name,note,address\r\n"Reyes, Ana","said ""ok""","line1\nline2"');
  });

  it('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('');
  });
});

describe('reporting window', () => {
  it('spans seven days for a week and a month for a month', () => {
    const now = new Date('2026-03-15T00:00:00Z');
    expect(periodRange('week', now).from.toISOString().slice(0, 10)).toBe('2026-03-08');
    expect(periodRange('month', now).from.toISOString().slice(0, 10)).toBe('2026-02-15');
  });
});
