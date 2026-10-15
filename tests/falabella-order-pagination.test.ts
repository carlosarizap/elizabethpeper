import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchAllFalabellaOrderPages,
  mapWithConcurrency,
  readFalabellaOrderPage,
} from '../src/app/lib/falabella/order-pagination.ts';

test('lee TotalCount y normaliza una orden única', () => {
  const page = readFalabellaOrderPage({
    SuccessResponse: {
      Head: { TotalCount: '1' },
      Body: { Orders: { Order: { OrderId: '123' } } },
    },
  });

  assert.equal(page.totalCount, 1);
  assert.deepEqual(page.orders, [{ OrderId: '123' }]);
});

test('recorre todas las páginas usando Limit y Offset', async () => {
  const offsets: number[] = [];
  const source = Array.from({ length: 205 }, (_, index) => index + 1);

  const orders = await fetchAllFalabellaOrderPages(async (offset, limit) => {
    offsets.push(offset);
    return {
      orders: source.slice(offset, offset + limit),
      totalCount: source.length,
    };
  });

  assert.deepEqual(offsets, [0, 100, 200]);
  assert.deepEqual(orders, source);
});

test('se detiene con una página corta cuando TotalCount no está disponible', async () => {
  const offsets: number[] = [];

  const orders = await fetchAllFalabellaOrderPages(async (offset, limit) => {
    offsets.push(offset);
    const source = [1, 2, 3];
    return {
      orders: source.slice(offset, offset + limit),
      totalCount: null,
    };
  }, 2);

  assert.deepEqual(offsets, [0, 2]);
  assert.deepEqual(orders, [1, 2, 3]);
});

test('limita la concurrencia y conserva el orden de resultados', async () => {
  let active = 0;
  let maxActive = 0;

  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 10;
  });

  assert.equal(maxActive, 2);
  assert.deepEqual(results, [10, 20, 30, 40, 50]);
});
