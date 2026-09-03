'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Logo, IconEye, IconEyeOff, IconLock, IconShield, IconArrow } from '@/components/icons';
import { site } from '@/lib/site';

const ASSURANCES = [
  'Access is limited by role and by branch',
  'Every view, change and printout is recorded',
  'Prescriptions stay drafts until the doctor signs',
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });

    if (error) {
      // Deliberately not "no account with that email": that would let anyone
      // test whether a given address belongs to clinic staff.
      setError('That email and password do not match an active staff account.');
      setBusy(false);
      return;
    }
    router.replace('/dashboard');
    router.refresh();
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel — decorative, so it is dropped entirely on small screens. */}
      <aside className="relative hidden overflow-hidden bg-brand p-12 text-brand-ink lg:flex lg:flex-col">
        <div className="grid-lines pointer-events-none absolute inset-0 opacity-[0.12]" aria-hidden="true" />
        <div
          className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-brand-ink/10 blur-3xl"
          aria-hidden="true"
        />

        <Link href="/" className="relative flex items-center gap-3 font-semibold">
          <Logo className="h-9 w-9" inverted />
          {site.name}
        </Link>

        <div className="relative mt-auto max-w-md">
          <p className="font-display text-3xl font-semibold leading-tight text-balance">
            The clinic record, built around who is responsible for it.
          </p>
          <p className="mt-4 leading-relaxed opacity-90 text-pretty">
            Five branches, one system — and a hard line between them. You see your branch,
            your patients and your work.
          </p>

          <ul className="mt-10 space-y-3">
            {ASSURANCES.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm opacity-95">
                <IconShield className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="text-pretty">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative mt-12 text-xs opacity-70">
          Health information handled under the Data Privacy Act (RA 10173).
        </p>
      </aside>

      {/* Sign-in form */}
      <main id="main" className="flex flex-col justify-center px-5 py-12 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="mb-10 inline-flex items-center gap-2.5 font-semibold lg:hidden">
            <Logo className="h-8 w-8" />
            {site.name}
          </Link>

          <span className="inline-flex items-center gap-1.5 rounded-full bg-raised px-3 py-1 text-xs font-medium text-muted">
            <IconLock width={13} height={13} /> Staff access only
          </span>

          <h1 className="mt-4 text-2xl font-semibold">Sign in</h1>
          <p className="mt-1.5 text-sm text-muted text-pretty">
            Use the account your branch administrator issued you.
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
            <div>
              <label htmlFor="email" className="label">Work email</label>
              <input
                id="email" name="email" type="email" required autoFocus
                autoComplete="username" inputMode="email"
                className="input" placeholder="you@clinic.ph"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'signin-error' : undefined}
                value={email} onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="password" className="label">Password</label>
              <div className="relative">
                <input
                  id="password" name="password" required
                  type={reveal ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="input pr-11"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'signin-error' : undefined}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={reveal ? 'Hide password' : 'Show password'}
                  aria-pressed={reveal}
                  className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-muted
                             transition hover:text-ink"
                >
                  {reveal ? <IconEyeOff width={18} height={18} /> : <IconEye width={18} height={18} />}
                </button>
              </div>
            </div>

            <div aria-live="polite" role="status">
              {error && (
                <p id="signin-error"
                   className="rounded-lg border border-critical/30 bg-critical/5 px-3 py-2.5 text-sm text-critical">
                  {error}
                </p>
              )}
            </div>

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? 'Signing in…' : <>Sign in <IconArrow width={16} height={16} /></>}
            </button>
          </form>

          <p className="mt-6 text-xs leading-relaxed text-muted text-pretty">
            Forgotten your password, or locked out? Ask your branch administrator — accounts are
            issued and reset locally, never over email.
          </p>

          <Link href="/" className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
            Back to {site.name}
          </Link>
        </div>
      </main>
    </div>
  );
}
