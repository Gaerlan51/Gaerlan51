import { cache } from 'react';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import type { Staff, StaffRole } from '@/lib/types';

/** The signed-in staff member, or null. Cached per request. */
export const currentStaff = cache(async (): Promise<Staff | null> => {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data } = await supabase
    .from('staff')
    .select('id, auth_user_id, clinic_id, role, full_name, discipline, prc_license_no')
    .eq('auth_user_id', auth.user.id)
    .eq('is_active', true)
    .maybeSingle();

  return (data as Staff) ?? null;
});

export async function requireStaff(): Promise<Staff> {
  const staff = await currentStaff();
  if (!staff) redirect('/login');
  return staff;
}

export async function requireRole(...roles: StaffRole[]): Promise<Staff> {
  const staff = await requireStaff();
  if (!roles.includes(staff.role)) {
    throw new Error(`This action is restricted to: ${roles.join(', ')}.`);
  }
  return staff;
}

export const can = {
  seeBilling: (s: Staff) => s.role !== 'therapist',
  seeClinicalNotes: (s: Staff) => s.role !== 'admin',
  sign: (s: Staff) => s.role === 'owner',
  schedule: (s: Staff) => s.role === 'owner' || s.role === 'admin',
  seeAllBranches: (s: Staff) => s.role === 'owner',
};
