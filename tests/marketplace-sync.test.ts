import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMarketplaceSyncUrl,
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
