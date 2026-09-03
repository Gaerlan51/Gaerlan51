import Link from 'next/link';
import { Logo, IconArrow } from '@/components/icons';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <Logo className="mx-auto h-10 w-10" />
        <h1 className="mt-6 text-2xl font-semibold">We couldn&apos;t find that page</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted text-pretty">
          The link may be out of date, or the record may belong to a branch your account
          cannot open.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/" className="btn-secondary">Public site</Link>
          <Link href="/dashboard" className="btn-primary">
            Go to dashboard <IconArrow width={16} height={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}
