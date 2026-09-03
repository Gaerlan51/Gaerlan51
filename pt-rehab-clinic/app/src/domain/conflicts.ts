/**
 * Turn database refusals into something a front-desk staff member can act on.
 *
 * The constraints in 0001_schema.sql are the real check (spec §4) — this maps
 * their error codes to readable text. An application-layer pre-check would
 * still race; the constraint cannot.
 */
export interface PostgresError { code?: string; message?: string; constraint?: string; details?: string }

export const EXCLUSION_VIOLATION = '23P01';
export const INSUFFICIENT_PRIVILEGE = '42501';
export const CHECK_VIOLATION = '23514';

export function describeWriteError(err: PostgresError | null | undefined): string | null {
  if (!err) return null;
  const text = `${err.constraint ?? ''} ${err.message ?? ''} ${err.details ?? ''}`;

  if (text.includes('appointments_no_provider_overlap')) {
    return 'That therapist already has an appointment overlapping this time. Pick another slot or another therapist.';
  }
  if (text.includes('appointments_no_room_overlap')) {
    return 'That room is already booked for an overlapping time. Pick another slot or another room.';
  }
  if (text.includes('appointments_ends_after_starts')) {
    return 'The end time must be after the start time.';
  }
  if (/only the owner\/doctor role may sign/i.test(text)) {
    return 'Only the doctor can sign this. It stays a draft until they do.';
  }
  if (/locked once the encounter is finalized/i.test(text)) {
    return 'This note is finalized and cannot be edited. File an addendum instead.';
  }
  if (/cannot be reopened/i.test(text)) {
    return 'A finalized encounter cannot be reopened. File an addendum instead.';
  }
  if (err.code === INSUFFICIENT_PRIVILEGE) {
    return 'You do not have permission to do that.';
  }
  return err.message ?? 'The change could not be saved.';
}

/**
 * An RLS denial on UPDATE/DELETE is a no-op, not an error: zero rows match the
 * policy. Callers must treat "nothing changed" as a refusal rather than
 * reporting success.
 */
export function assertAffected(rowCount: number | null | undefined, what: string): void {
  if (!rowCount) {
    throw new Error(
      `${what} was not saved. The record is outside your branch, or your role cannot change it.`,
    );
  }
}
