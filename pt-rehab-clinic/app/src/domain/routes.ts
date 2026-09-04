/**
 * Which routes are reachable without a staff session.
 *
 * Extracted from the middleware so it can be tested directly: this is the
 * single check standing between the public internet and every patient record,
 * and it has one obvious way to get it catastrophically wrong — matching "/"
 * by prefix, which makes the entire app public.
 */
export const PUBLIC_EXACT = new Set([
  '/', '/services', '/branches', '/about', '/contact', '/login',
]);

/** Prefix-matched. The cron endpoint carries its own bearer secret. */
export const PUBLIC_PREFIXES = ['/api/cron'];

export function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Whether Supabase credentials are actually present.
 *
 * A fresh deploy with the placeholder values from .env.example would otherwise
 * throw inside the auth call and serve a 500 on every protected route, which
 * looks like a broken app rather than an unfinished setup.
 */
export function isSupabaseConfigured(url?: string, key?: string): boolean {
  if (!url || !key) return false;
  if (url.includes('placeholder') || key.includes('placeholder')) return false;
  return url.startsWith('https://');
}
