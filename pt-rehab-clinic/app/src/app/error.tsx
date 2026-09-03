'use client';
import Link from 'next/link';
import { Logo } from '@/components/icons';

/**
 * The message is shown as-is because the errors that reach here are our own
 * refusals — "outside your branch", "only the doctor can sign" — which staff
 * need to read. Supabase surfaces nothing sensitive in them.
 */
export default function ErrorBoundary({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <Logo className="mx-auto h-10 w-10" />
        <h1 className="mt-6 text-2xl font-semibold">That didn&apos;t go through</h1>
        <p className="mt-3 rounded-lg border border-critical/30 bg-critical/5 px-4 py-3 text-sm text-pretty">
          {error.message || 'Something went wrong.'}
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <button onClick={reset} className="btn-primary">Try again</button>
          <Link href="/dashboard" className="btn-secondary">Back to dashboard</Link>
        </div>
        {error.digest ? (
          <p className="mt-6 text-xs text-muted">Reference: {error.digest}</p>
        ) : null}
      </div>
    </div>
  );
}
