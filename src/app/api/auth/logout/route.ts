import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/app/lib/auth/session';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
