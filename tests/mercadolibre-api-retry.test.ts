import assert from 'node:assert/strict';
import test from 'node:test';
import { getMercadoLibreRetryDelayMs } from '../src/app/lib/mercadolibre/api-retry.ts';

test('Mercado Libre reintenta respuestas 429 con espera exponencial', () => {
  assert.equal(getMercadoLibreRetryDelayMs(429, null, 0), 1000);
  assert.equal(getMercadoLibreRetryDelayMs(429, null, 1), 2000);
  assert.equal(getMercadoLibreRetryDelayMs(429, null, 2), 4000);
  assert.equal(getMercadoLibreRetryDelayMs(429, null, 3), null);
});

test('Mercado Libre respeta Retry-After y no reintenta otros errores', () => {
  assert.equal(getMercadoLibreRetryDelayMs(429, '5', 0), 5000);
  assert.equal(getMercadoLibreRetryDelayMs(429, '30', 0), 15000);
  assert.equal(getMercadoLibreRetryDelayMs(500, null, 0), null);
});
