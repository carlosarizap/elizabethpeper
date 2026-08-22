import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMarketplaceSyncUrl,
  getMarketplaceSyncDays,
  getMarketplaceSyncMode,
  marketplacePayloadHasFailures,
} from '../src/app/lib/orders/marketplace-sync.ts';

test('sin modo explícito usa la sincronización rápida de órdenes', () => {
  assert.equal(getMarketplaceSyncMode(new URLSearchParams()), 'orders');
  assert.equal(
    getMarketplaceSyncMode(new URLSearchParams({ mode: 'desconocido' })),
    'orders',
  );
});

test('mode=returns selecciona la revisión histórica', () => {
  assert.equal(
    getMarketplaceSyncMode(new URLSearchParams({ mode: 'returns' })),
    'returns',
  );
});

test('el orquestador propaga el modo al endpoint de cada marketplace', () => {
  assert.equal(
    buildMarketplaceSyncUrl(
      'http://localhost:3000',
      '/api/walmart/orders',
      'returns',
    ),
    'http://localhost:3000/api/walmart/orders?mode=returns',
  );
  assert.equal(
    buildMarketplaceSyncUrl(
      'http://localhost:3000',
      '/api/walmart/orders',
      'returns',
      14,
    ),
    'http://localhost:3000/api/walmart/orders?mode=returns&days=14',
  );
});

test('el rango dirigido se valida y se limita a 60 días', () => {
  assert.equal(getMarketplaceSyncDays(new URLSearchParams({ days: '14' }), 60), 14);
  assert.equal(getMarketplaceSyncDays(new URLSearchParams({ days: '0' }), 60), 60);
  assert.equal(getMarketplaceSyncDays(new URLSearchParams({ days: '90' }), 60), 60);
});

test('detecta errores parciales aunque el endpoint responda HTTP 200', () => {
  assert.equal(
    marketplacePayloadHasFailures({
      results: [{ success: true }, { success: false, error: 'falló' }],
    }),
    true,
  );
  assert.equal(
    marketplacePayloadHasFailures({ results: [{ success: true }] }),
    false,
  );
});
