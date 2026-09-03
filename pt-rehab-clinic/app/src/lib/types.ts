export type StaffRole = 'owner' | 'admin' | 'therapist';
export type Discipline = 'PT' | 'OT' | 'Speech' | 'Psych' | 'PO' | 'MD';
export type PayerType = 'philhealth' | 'hmo' | 'cash' | 'referral';
export type CaseType = 'msk' | 'neuro' | 'pedia' | 'other';
export type FollowupRule = 'every_6_sessions' | 'monthly';
export type EncounterKind = 'md_consult' | 'therapy_session' | 'acupuncture';
export type DocumentKind = 'referral_back' | 'referral_out' | 'prescription';
export type DocumentStatus = 'draft' | 'signed' | 'voided';
export type ReminderKind = 'appointment' | 'birthday' | 'followup_due';
export type ReminderChannel = 'sms' | 'email';
export type ReminderStatus = 'queued' | 'approved' | 'sent' | 'failed' | 'skipped';

export interface Staff {
  id: string;
  auth_user_id: string;
  clinic_id: string;
  role: StaffRole;
  full_name: string;
  discipline: Discipline | null;
  prc_license_no: string | null;
}

export interface Patient {
  id: string;
  clinic_id: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  sex: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  payer_type: PayerType;
  hmo_name: string | null;
  philhealth_no: string | null;
  referring_physician_id: string | null;
  consent_signed_at: string | null;
  notes: string | null;
}

export interface Episode {
  id: string;
  clinic_id: string;
  patient_id: string;
  diagnosis: string;
  icd10_code: string | null;
  case_type: CaseType;
  followup_rule: FollowupRule;
  started_on: string;
  ended_on: string | null;
  primary_therapist_id: string | null;
  status: 'active' | 'completed' | 'discontinued';
}

/** One row of v_followup_due — the single definition of the rule (spec §8). */
export interface FollowupRow {
  episode_id: string;
  clinic_id: string;
  patient_id: string;
  followup_rule: FollowupRule;
  case_type: CaseType;
  diagnosis: string;
  anchor: string;
  sessions_since_anchor: number;
  days_since_anchor: number;
  is_due: boolean;
}

export interface DashboardRow {
  clinic_id: string;
  clinic_name: string;
  consultations: number;
  therapy_sessions: number;
  active_patients: number;
  new_patients: number;
  followups_due: number;
  no_shows: number;
  appointments: number;
}
