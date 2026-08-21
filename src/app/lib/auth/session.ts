export const SESSION_COOKIE_NAME = 'epeper_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10;
export const INTERNAL_SESSION_USERNAME = '__internal_marketplace_sync__';

export interface SessionPayload {
  username: string;
  iat: number;
  exp: number;
}

function getSigningSecret(): string {
  return process.env.AUTH_SESSION_SECRET || process.env.APP_PASSWORD || '';
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importSigningKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export function isAuthenticationConfigured(): boolean {
  return Boolean(
    process.env.APP_USERNAME &&
      process.env.APP_PASSWORD &&
      getSigningSecret(),
  );
}

export async function createSessionToken(
  username: string,
  maxAgeSeconds = SESSION_MAX_AGE_SECONDS,
): Promise<string> {
  const secret = getSigningSecret();
  if (!secret) throw new Error('Falta configurar AUTH_SESSION_SECRET o APP_PASSWORD');

  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    username,
    iat: now,
    exp: now + maxAgeSeconds,
  };
  const encodedPayload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const key = await importSigningKey(secret);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(encodedPayload),
  );

  return `${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(
  token: string | undefined,
): Promise<SessionPayload | null> {
  const secret = getSigningSecret();
  if (!secret || !token) return null;

  try {
    const [encodedPayload, encodedSignature, extra] = token.split('.');
    if (!encodedPayload || !encodedSignature || extra) return null;

    const key = await importSigningKey(secret);
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(encodedSignature) as BufferSource,
      new TextEncoder().encode(encodedPayload),
    );
    if (!isValid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(encodedPayload)),
    ) as Partial<SessionPayload>;
    const now = Math.floor(Date.now() / 1000);

    if (
      typeof payload.username !== 'string' ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number' ||
      payload.exp <= now
    ) {
      return null;
    }

    return payload as SessionPayload;
  } catch {
    return null;
  }
}

async function digest(value: string): Promise<Uint8Array> {
  const result = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return new Uint8Array(result);
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest[index] ^ rightDigest[index];
  }
  return difference === 0;
}

export async function credentialsAreValid(
  username: string,
  password: string,
): Promise<boolean> {
  const configuredUsername = process.env.APP_USERNAME;
  const configuredPassword = process.env.APP_PASSWORD;
  if (!configuredUsername || !configuredPassword) return false;

  const [validUsername, validPassword] = await Promise.all([
    constantTimeEqual(username, configuredUsername),
    constantTimeEqual(password, configuredPassword),
  ]);
  return validUsername && validPassword;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function shouldRefreshSession(payload: SessionPayload): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now - payload.iat >= 60 * 60 * 24;
}

export async function createInternalSessionToken(): Promise<string> {
  return createSessionToken(INTERNAL_SESSION_USERNAME, 5 * 60);
}
