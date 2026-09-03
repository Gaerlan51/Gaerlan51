/**
 * Deciding which reminders to draft (spec §10) — pure, so the rules can be
 * tested without a database or a provider account.
 */
import {
  appointmentWindow, dedupeKey, draftFor, manilaDay, preferredChannel, type Locale,
} from '@/domain/reminders';
import type { ReminderChannel, ReminderKind } from '@/lib/types';

export interface PlanPatient {
  id: string;
  clinic_id: string;
  first_name: string;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
}

export interface PlanAppointment {
  id: string;
  clinic_id: string;
  patient_id: string;
  starts_at: string;
  provider_name?: string | null;
}

export interface PlanFollowup {
  episode_id: string;
  clinic_id: string;
  patient_id: string;
  is_due: boolean;
}

export interface PlannedReminder {
  clinic_id: string;
  patient_id: string;
  appointment_id: string | null;
  episode_id: string | null;
  kind: ReminderKind;
  channel: ReminderChannel;
  scheduled_for: string;
  draft_body: string;
  dedupe_key: string;
}

export interface PlanInput {
  now: Date;
  clinicNames: Record<string, string>;
  clinicPhones?: Record<string, string | null>;
  patients: PlanPatient[];
  appointments: PlanAppointment[];
  followups: PlanFollowup[];
  locale?: Locale;
}

/** Same month and day, ignoring year. */
export function isBirthdayToday(birthDate: string | null, now: Date): boolean {
  if (!birthDate) return false;
  const today = manilaDay(now);          // YYYY-MM-DD in Manila
  return birthDate.slice(5, 10) === today.slice(5, 10);
}

export function planReminders(input: PlanInput): PlannedReminder[] {
  const { now, patients, clinicNames, clinicPhones = {}, locale = 'en' } = input;
  const byId = new Map(patients.map((p) => [p.id, p]));
  const planned: PlannedReminder[] = [];
  const seen = new Set<string>();

  const push = (r: PlannedReminder) => {
    if (seen.has(r.dedupe_key)) return;
    seen.add(r.dedupe_key);
    planned.push(r);
  };

  const contextFor = (patient: PlanPatient, when?: Date, providerName?: string | null) => ({
    patientFirstName: patient.first_name,
    clinicName: clinicNames[patient.clinic_id] ?? 'your clinic',
    clinicPhone: clinicPhones[patient.clinic_id] ?? null,
    providerName: providerName ?? null,
    when,
  });

  // 1. Appointments starting 24–48h from now.
  const window = appointmentWindow(now);
  for (const appt of input.appointments) {
    const starts = new Date(appt.starts_at);
    if (starts < window.from || starts >= window.to) continue;
    const patient = byId.get(appt.patient_id);
    if (!patient) continue;
    const channel = preferredChannel(patient);
    if (!channel) continue;

    push({
      clinic_id: appt.clinic_id,
      patient_id: patient.id,
      appointment_id: appt.id,
      episode_id: null,
      kind: 'appointment',
      channel,
      scheduled_for: now.toISOString(),
      draft_body: draftFor('appointment', contextFor(patient, starts, appt.provider_name), locale),
      dedupe_key: dedupeKey('appointment', channel, appt.id, now),
    });
  }

  // 2. Birthdays.
  for (const patient of patients) {
    if (!isBirthdayToday(patient.birth_date, now)) continue;
    const channel = preferredChannel(patient);
    if (!channel) continue;

    push({
      clinic_id: patient.clinic_id,
      patient_id: patient.id,
      appointment_id: null,
      episode_id: null,
      kind: 'birthday',
      channel,
      scheduled_for: now.toISOString(),
      draft_body: draftFor('birthday', contextFor(patient), locale),
      dedupe_key: dedupeKey('birthday', channel, patient.id, now),
    });
  }

  // 3. Episodes that have just become due for MD follow-up.
  for (const followup of input.followups) {
    if (!followup.is_due) continue;
    const patient = byId.get(followup.patient_id);
    if (!patient) continue;
    const channel = preferredChannel(patient);
    if (!channel) continue;

    push({
      clinic_id: followup.clinic_id,
      patient_id: patient.id,
      appointment_id: null,
      episode_id: followup.episode_id,
      kind: 'followup_due',
      channel,
      scheduled_for: now.toISOString(),
      draft_body: draftFor('followup_due', contextFor(patient), locale),
      dedupe_key: dedupeKey('followup_due', channel, followup.episode_id, now),
    });
  }

  return planned;
}
