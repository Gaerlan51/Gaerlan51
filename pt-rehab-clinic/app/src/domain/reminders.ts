/**
 * Reminder drafting (spec §10).
 *
 * These builders deliberately do not accept a diagnosis, note, or any other
 * clinical field. A reminder cannot leak what the system never hands it — that
 * is a structural guarantee rather than a review checklist item.
 *
 * Nothing here sends anything. Drafts land in the queue and a staff member
 * approves them; see src/server/reminders.ts.
 */
import type { ReminderChannel, ReminderKind } from '@/lib/types';

export const APP_TIMEZONE = process.env.APP_TIMEZONE ?? 'Asia/Manila';

export type Locale = 'en' | 'tl';

export interface ReminderContext {
  patientFirstName: string;
  clinicName: string;
  clinicPhone?: string | null;
  providerName?: string | null;
  when?: Date;
}

export function formatManila(date: Date, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: APP_TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
    ...opts,
  }).format(date);
}

export function draftAppointmentReminder(ctx: ReminderContext, locale: Locale = 'en'): string {
  const when = ctx.when ? formatManila(ctx.when) : 'your scheduled time';
  const provider = ctx.providerName ? ` with ${ctx.providerName}` : '';
  const contact = ctx.clinicPhone ? ` For changes, please call ${ctx.clinicPhone}.` : '';

  if (locale === 'tl') {
    return `Magandang araw po, ${ctx.patientFirstName}! Paalala po sa inyong appointment sa ${ctx.clinicName}${provider} sa ${when}. Salamat po!${contact}`;
  }
  return `Magandang araw po, ${ctx.patientFirstName}! This is a reminder of your appointment at ${ctx.clinicName}${provider} on ${when}. Thank you po!${contact}`;
}

export function draftBirthdayGreeting(ctx: ReminderContext, locale: Locale = 'en'): string {
  if (locale === 'tl') {
    return `Maligayang kaarawan po, ${ctx.patientFirstName}! Mula sa buong team ng ${ctx.clinicName}, nawa'y maging masaya at malusog po ang inyong araw.`;
  }
  return `Happy birthday po, ${ctx.patientFirstName}! From all of us at ${ctx.clinicName}, we wish you a joyful and healthy year ahead.`;
}

export function draftFollowupDue(ctx: ReminderContext, locale: Locale = 'en'): string {
  const contact = ctx.clinicPhone ? ` please call ${ctx.clinicPhone}` : ' please contact the clinic';
  if (locale === 'tl') {
    return `Magandang araw po, ${ctx.patientFirstName}! Panahon na po para sa inyong follow-up check-up sa ${ctx.clinicName}. Para po makapag-schedule,${contact}. Salamat po!`;
  }
  return `Magandang araw po, ${ctx.patientFirstName}! It's time for your follow-up check-up at ${ctx.clinicName}. To book a schedule,${contact}. Thank you po!`;
}

export function draftFor(kind: ReminderKind, ctx: ReminderContext, locale: Locale = 'en'): string {
  switch (kind) {
    case 'appointment': return draftAppointmentReminder(ctx, locale);
    case 'birthday': return draftBirthdayGreeting(ctx, locale);
    case 'followup_due': return draftFollowupDue(ctx, locale);
  }
}

/** Calendar day in Manila, used to keep dedupe keys stable across a run. */
export function manilaDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE }).format(date);
}

/**
 * One reminder per patient, per kind, per day, per channel. The generator runs
 * hourly (spec §10); without this the queue would fill with duplicates.
 */
export function dedupeKey(
  kind: ReminderKind, channel: ReminderChannel, subjectId: string, on: Date,
): string {
  return `${kind}:${channel}:${subjectId}:${manilaDay(on)}`;
}

/** Appointments starting 24–48h from now (spec §10). */
export function appointmentWindow(now: Date): { from: Date; to: Date } {
  const hour = 3_600_000;
  return { from: new Date(now.getTime() + 24 * hour), to: new Date(now.getTime() + 48 * hour) };
}

/** SMS when we have a mobile number, otherwise email. */
export function preferredChannel(
  patient: { phone?: string | null; email?: string | null },
): ReminderChannel | null {
  if (patient.phone) return 'sms';
  if (patient.email) return 'email';
  return null;
}
