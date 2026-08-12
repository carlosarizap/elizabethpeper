import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeFalabellaOrderStatus,
  normalizeOrderStatus,
} from '../src/app/lib/orders/marketplace-status-mappers.ts';
import { MARKETPLACES } from '../src/app/lib/constants/marketplaces.ts';
import {
  isValidOrderStatusTransition,
  ORDER_STATUSES,
} from '../src/app/lib/orders/order-status.ts';

const falabellaCases = [
  ['pending', ORDER_STATUSES.PENDING],
  ['ready_To_Ship', ORDER_STATUSES.PENDING],
  ['ready_to_ship', ORDER_STATUSES.PENDING],
  ['READY_TO_SHIP', ORDER_STATUSES.PENDING],
  ['Ready To Ship', ORDER_STATUSES.PENDING],
  ['ready-to-ship', ORDER_STATUSES.PENDING],
  ['shipped', ORDER_STATUSES.SHIPPED],
  ['delivered', ORDER_STATUSES.DELIVERED],
  ['returned', ORDER_STATUSES.RETURNED],
  ['failed', ORDER_STATUSES.CANCELED],
  ['canceled', ORDER_STATUSES.CANCELED],
] as const;

for (const [externalStatus, expectedStatus] of falabellaCases) {
  test(`Falabella: ${externalStatus} -> ${expectedStatus}`, () => {
    assert.equal(normalizeFalabellaOrderStatus(externalStatus), expectedStatus);
  });
}

test('Falabella usa pendiente como fallback para estados vacÃ­os o desconocidos', () => {
  assert.equal(normalizeFalabellaOrderStatus(undefined), ORDER_STATUSES.PENDING);
  assert.equal(normalizeFalabellaOrderStatus(null), ORDER_STATUSES.PENDING);
  assert.equal(normalizeFalabellaOrderStatus('estado_nuevo'), ORDER_STATUSES.PENDING);
});

test('El normalizador general selecciona el mapeador de Falabella', () => {
  assert.equal(
    normalizeOrderStatus(MARKETPLACES.FALABELLA, 'shipped'),
    ORDER_STATUSES.SHIPPED,
  );
});

const transitionCases = [
  [ORDER_STATUSES.PENDING, ORDER_STATUSES.SHIPPED, true],
  [ORDER_STATUSES.PENDING, ORDER_STATUSES.DELIVERED, true],
  [ORDER_STATUSES.PENDING, ORDER_STATUSES.CANCELED, true],
  [ORDER_STATUSES.SHIPPED, ORDER_STATUSES.DELIVERED, true],
  [ORDER_STATUSES.SHIPPED, ORDER_STATUSES.CANCELED, true],
  [ORDER_STATUSES.DELIVERED, ORDER_STATUSES.RETURNED, true],
  [ORDER_STATUSES.DELIVERED, ORDER_STATUSES.PENDING, false],
  [ORDER_STATUSES.DELIVERED, ORDER_STATUSES.SHIPPED, false],
  [ORDER_STATUSES.CANCELED, ORDER_STATUSES.PENDING, false],
  [ORDER_STATUSES.CANCELED, ORDER_STATUSES.SHIPPED, false],
  [ORDER_STATUSES.RETURNED, ORDER_STATUSES.DELIVERED, false],
] as const;

for (const [currentStatus, nextStatus, expected] of transitionCases) {
  test(`TransiciÃ³n ${currentStatus} -> ${nextStatus}: ${expected}`, () => {
    assert.equal(
      isValidOrderStatusTransition(currentStatus, nextStatus),
      expected,
    );
  });
}
