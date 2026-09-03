import { requireStaff } from '@/server/session';
import { supabaseServer } from '@/lib/supabase/server';
import { AppNav } from '@/components/app/AppNav';

export const dynamic = 'force-dynamic';

/** Authenticated shell. Everything under it requires a staff session. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const supabase = await supabaseServer();
  const { data: clinic } = await supabase
    .from('clinics').select('name').eq('id', staff.clinic_id).maybeSingle();

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <AppNav
        staff={{
          full_name: staff.full_name,
          role: staff.role,
          clinic_name: clinic?.name ?? 'Branch',
        }}
      />
      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
