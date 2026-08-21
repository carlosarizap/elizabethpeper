import assert from 'node:assert/strict';
import test from 'node:test';
import { withoutPostgresSslQueryParameters } from '../src/app/lib/postgres-ssl.ts';

test('el pool controla SSL aunque POSTGRES_URL incluya sslmode', () => {
  const result = withoutPostgresSslQueryParameters(
    'postgresql://user:pass@example.com:6543/db?sslmode=require&pgbouncer=true',
  );
  const url = new URL(result);

  assert.equal(url.searchParams.has('sslmode'), false);
  assert.equal(url.searchParams.get('pgbouncer'), 'true');
});

test('elimina parámetros SSL que reemplazan la configuración de pg', () => {
  const result = withoutPostgresSslQueryParameters(
    'postgresql://user:pass@example.com/db?sslcert=a&sslkey=b&sslrootcert=c&uselibpqcompat=true',
  );
  const url = new URL(result);

  assert.equal(url.search, '');
});
