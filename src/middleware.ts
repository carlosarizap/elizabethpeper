import { NextRequest, NextResponse } from 'next/server';
import {
  createSessionToken,
  INTERNAL_SESSION_USERNAME,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  shouldRefreshSession,
  verifySessionToken,
} from '@/app/lib/auth/session';

function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.startsWith('/api/auth/') ||
    pathname === '/api/cron' ||
    pathname.startsWith('/api/cron/')
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = await verifySessionToken(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );

  if (pathname === '/login') {
    if (session && session.username !== INTERNAL_SESSION_USERNAME) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) return NextResponse.next();

  const internalSession = await verifySessionToken(
    request.headers.get('x-internal-session') || undefined,
  );
  if (
    pathname.startsWith('/api/') &&
    internalSession?.username === INTERNAL_SESSION_USERNAME
  ) {
    return NextResponse.next();
  }

  if (!session || session.username === INTERNAL_SESSION_USERNAME) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('returnTo', `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  if (shouldRefreshSession(session)) {
    response.cookies.set(
      SESSION_COOKIE_NAME,
      await createSessionToken(session.username),
      sessionCookieOptions(),
    );
  }
  return response;
}

export const config = {
  matcher: ['/', '/dashboard/:path*', '/orders/:path*', '/api/:path*'],
};
