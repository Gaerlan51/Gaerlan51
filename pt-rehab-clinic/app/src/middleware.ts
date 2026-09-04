import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { isPublicRoute, isSupabaseConfigured } from '@/domain/routes';

/** Refreshes the Supabase session and keeps unauthenticated users out. */
export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  if (isPublicRoute(request.nextUrl.pathname)) return response;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Not configured yet: send people to sign-in, which explains the setup,
  // rather than throwing a 500 from inside the auth client.
  if (!isSupabaseConfigured(url, key)) {
    const target = request.nextUrl.clone();
    target.pathname = '/login';
    target.search = '';
    return NextResponse.redirect(target);
  }

  const supabase = createServerClient(
    url!,
    key!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list: { name: string; value: string; options: CookieOptions }[]) =>
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)),
      },
    },
  );

  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
};
