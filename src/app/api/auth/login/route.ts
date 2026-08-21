import { NextRequest, NextResponse } from 'next/server';
import {
  createSessionToken,
  credentialsAreValid,
  isAuthenticationConfigured,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from '@/app/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isAuthenticationConfigured()) {
    return NextResponse.json(
      { error: 'El acceso todavía no está configurado en el servidor.' },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!(await credentialsAreValid(username, password))) {
    return NextResponse.json(
      { error: 'Usuario o contraseña incorrectos.' },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    await createSessionToken(username),
    sessionCookieOptions(),
  );
  return response;
}
