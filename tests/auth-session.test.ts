import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSessionToken,
  credentialsAreValid,
  verifySessionToken,
} from '../src/app/lib/auth/session.ts';

test('crea y verifica una sesión firmada', async () => {
  process.env.APP_PASSWORD = 'test-password';
  const token = await createSessionToken('epeper', 60);
  const session = await verifySessionToken(token);

  assert.equal(session?.username, 'epeper');
});

test('rechaza una sesión modificada', async () => {
  process.env.APP_PASSWORD = 'test-password';
  const token = await createSessionToken('epeper', 60);
  const [payload, signature] = token.split('.');
  const tamperedSignature = `${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;
  const tamperedToken = `${payload}.${tamperedSignature}`;

  assert.equal(await verifySessionToken(tamperedToken), null);
});

test('valida ambas credenciales', async () => {
  process.env.APP_USERNAME = 'epeper';
  process.env.APP_PASSWORD = 'test-password';

  assert.equal(await credentialsAreValid('epeper', 'test-password'), true);
  assert.equal(await credentialsAreValid('epeper', 'incorrecta'), false);
  assert.equal(await credentialsAreValid('otro', 'test-password'), false);
});
