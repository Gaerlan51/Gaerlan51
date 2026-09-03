'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Card, Field } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(error.message);
    else router.replace('/dashboard');
  }

  return (
    <div className="mx-auto max-w-sm py-12">
      <Card title="Staff sign in">
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Email">
            <input className="input" type="email" value={email} required
              onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <input className="input" type="password" value={password} required
              onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="mt-4 text-xs text-slate-500">
          Staff access only. The patient portal is out of scope for Phase 1.
        </p>
      </Card>
    </div>
  );
}
