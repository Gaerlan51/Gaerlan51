'use server';
/**
 * Thin FormData wrappers so pages can post directly to server actions without
 * a client component for every button. Each one delegates to the module that
 * owns the rule; none of them relaxes a check.
 */
import { redirect } from 'next/navigation';
import { createPatient, createEpisode } from '@/server/patients';
import { finalizeEncounter, createEncounter, saveSoap, createAddendum } from '@/server/encounters';
import { signDocument, createDocument } from '@/server/documents';
import { signProgram, createProgram } from '@/server/programs';
import { completeSession, bookAppointment } from '@/server/scheduling';
import { approveReminders, sendReminder, skipReminder } from '@/server/reminders';
import type { Discipline } from '@/lib/types';

const str = (form: FormData, key: string) => String(form.get(key) ?? '');
const opt = (form: FormData, key: string) => {
  const value = String(form.get(key) ?? '');
  return value === '' ? null : value;
};

export async function createPatientAction(form: FormData) {
  const id = await createPatient(form);
  redirect(`/patients/${id}`);
}

export async function createEpisodeAction(form: FormData) {
  await createEpisode(form);
}

export async function startConsultAction(form: FormData) {
  const patientId = str(form, 'patient_id');
  await createEncounter({
    patient_id: patientId,
    episode_id: opt(form, 'episode_id'),
    kind: 'md_consult',
  });
}

export async function saveSoapAction(form: FormData) {
  await saveSoap(str(form, 'encounter_id'), form);
}

export async function finalizeEncounterAction(form: FormData) {
  await finalizeEncounter(str(form, 'encounter_id'), str(form, 'patient_id'));
}

export async function addendumAction(form: FormData) {
  await createAddendum(str(form, 'encounter_id'), str(form, 'patient_id'), opt(form, 'episode_id'));
}

export async function createProgramAction(form: FormData) {
  await createProgram({
    patient_id: str(form, 'patient_id'),
    episode_id: opt(form, 'episode_id'),
    discipline: str(form, 'discipline') as Discipline,
    title: str(form, 'title'),
    template_id: opt(form, 'template_id'),
  });
}

export async function signProgramAction(form: FormData) {
  await signProgram(str(form, 'program_id'), str(form, 'patient_id'));
}

export async function createDocumentAction(form: FormData) {
  await createDocument({
    patient_id: str(form, 'patient_id'),
    episode_id: opt(form, 'episode_id'),
    kind: str(form, 'kind') as 'prescription',
    title: str(form, 'title'),
    body: { text: str(form, 'text'), recipient: opt(form, 'recipient') },
  });
}

export async function signDocumentAction(form: FormData) {
  await signDocument(str(form, 'document_id'), str(form, 'patient_id'));
}

export async function bookAppointmentAction(form: FormData) {
  await bookAppointment({
    patient_id: str(form, 'patient_id'),
    episode_id: opt(form, 'episode_id'),
    provider_id: str(form, 'provider_id'),
    room_id: opt(form, 'room_id'),
    starts_at: new Date(str(form, 'starts_at')).toISOString(),
    ends_at: new Date(str(form, 'ends_at')).toISOString(),
    kind: str(form, 'kind') as 'therapy_session',
  });
}

export async function completeSessionAction(form: FormData) {
  await completeSession(str(form, 'appointment_id'));
}

export async function approveRemindersAction(form: FormData) {
  await approveReminders(form.getAll('reminder_id').map(String));
}

export async function sendReminderAction(form: FormData) {
  await sendReminder(str(form, 'reminder_id'));
}

export async function skipReminderAction(form: FormData) {
  await skipReminder(str(form, 'reminder_id'));
}
