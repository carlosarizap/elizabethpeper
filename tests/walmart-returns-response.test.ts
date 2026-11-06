import assert from 'node:assert/strict';
import test from 'node:test';
import { isWalmartReturnsNotFound } from '../src/app/lib/walmart/returns-response.ts';

test('Walmart trata Returns not found como una lista vacía', () => {
  assert.equal(
    isWalmartReturnsNotFound(404, {
      error: {
        code: '404.ORDER_SERVICE.100',
        description: 'Returns not found',
      },
    }),
    true,
  );
});

test('Walmart conserva otros errores como fallos reales', () => {
  assert.equal(
    isWalmartReturnsNotFound(500, {
      error: {
        code: '500.ORDER_SERVICE.001',
        description: 'Internal error',
      },
    }),
    false,
  );
  assert.equal(
    isWalmartReturnsNotFound(404, {
      error: {
        code: '404.ORDER_SERVICE.999',
        description: 'Order not found',
      },
    }),
    false,
  );
});
