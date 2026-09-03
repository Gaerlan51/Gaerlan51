/**
 * Presentation of the follow-up rule. The rule itself lives in one place only —
 * the v_followup_due view (spec §8) — and is never recomputed here.
 */
import type { FollowupRow } from '@/lib/types';

export const SESSIONS_PER_REVIEW = 6;

export function followupLabel(row: FollowupRow): string {
  if (row.followup_rule === 'monthly') {
    return row.is_due
      ? `Due for MD follow-up — ${row.days_since_anchor} days since last review`
      : `${Math.max(0, 30 - row.days_since_anchor)} days until monthly review`;
  }
  const remaining = Math.max(0, SESSIONS_PER_REVIEW - row.sessions_since_anchor);
  return row.is_due
    ? `Due for MD follow-up — ${row.sessions_since_anchor} sessions since last review`
    : `${remaining} session${remaining === 1 ? '' : 's'} until MD review`;
}

/** Why this episode follows the rule it does — shown next to the banner. */
export function ruleExplanation(row: FollowupRow): string {
  return row.followup_rule === 'monthly'
    ? 'Paediatric rehab case: reviewed monthly.'
    : 'Musculoskeletal / neurologic case: reviewed every 6 therapy sessions.';
}

export function sortByUrgency(rows: FollowupRow[]): FollowupRow[] {
  return [...rows].sort((a, b) => {
    if (a.is_due !== b.is_due) return a.is_due ? -1 : 1;
    if (a.followup_rule === 'monthly' && b.followup_rule === 'monthly') {
      return b.days_since_anchor - a.days_since_anchor;
    }
    return b.sessions_since_anchor - a.sessions_since_anchor;
  });
}

/** Spec §8: the rule is defaulted from the case type, and stays overridable. */
export function defaultFollowupRule(caseType: 'msk' | 'neuro' | 'pedia' | 'other') {
  return caseType === 'pedia' ? 'monthly' : 'every_6_sessions';
}
