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
