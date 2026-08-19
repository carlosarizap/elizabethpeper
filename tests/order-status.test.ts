import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateMercadoLibreOrderStatuses,
  normalizeFalabellaOrderStatus,
  normalizeMercadoLibreOrderStatus,
  normalizeOrderStatus,
  normalizeParisOrderStatus,
  normalizeRipleyOrderStatus,
  resolveParisOrderStatus,
  resolveMercadoLibreOrderStatus,
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

const mercadoLibreCases = [
  ['cancelled', ORDER_STATUSES.CANCELED],
  ['pending_cancel', ORDER_STATUSES.CANCELED],
  ['not_delivered', ORDER_STATUSES.CANCELED],
  ['delivered', ORDER_STATUSES.DELIVERED],
  ['shipped', ORDER_STATUSES.SHIPPED],
  ['handling', ORDER_STATUSES.PENDING],
  ['ready_to_ship', ORDER_STATUSES.PENDING],
  ['confirmed', ORDER_STATUSES.PENDING],
  ['payment_required', ORDER_STATUSES.PENDING],
  ['payment_in_process', ORDER_STATUSES.PENDING],
  ['partially_paid', ORDER_STATUSES.PENDING],
  ['partially_refunded', ORDER_STATUSES.PENDING],
  ['paid', ORDER_STATUSES.PENDING],
] as const;

for (const [externalStatus, expectedStatus] of mercadoLibreCases) {
  test(`Mercado Libre: ${externalStatus} -> ${expectedStatus}`, () => {
    assert.equal(normalizeMercadoLibreOrderStatus(externalStatus), expectedStatus);
  });
}

test('Mercado Libre prioriza el estado logistico', () => {
  assert.equal(
    resolveMercadoLibreOrderStatus('paid', 'delivered'),
    ORDER_STATUSES.DELIVERED,
  );
  assert.equal(
    resolveMercadoLibreOrderStatus('cancelled', 'shipped'),
    ORDER_STATUSES.SHIPPED,
  );
});

test('Un pack entregado parcialmente conserva estado recibido', () => {
  assert.equal(
    aggregateMercadoLibreOrderStatuses([
      ORDER_STATUSES.DELIVERED,
      ORDER_STATUSES.CANCELED,
    ]),
    ORDER_STATUSES.DELIVERED,
  );
});

test('Mercado Libre refleja devolucion total en la cabecera', () => {
  assert.equal(
    aggregateMercadoLibreOrderStatuses([ORDER_STATUSES.RETURNED]),
    ORDER_STATUSES.RETURNED,
  );
  assert.equal(
    aggregateMercadoLibreOrderStatuses([
      ORDER_STATUSES.DELIVERED,
      ORDER_STATUSES.RETURNED,
    ]),
    ORDER_STATUSES.DELIVERED,
  );
});

test('El normalizador general selecciona el mapeador de Mercado Libre', () => {
  assert.equal(
    normalizeOrderStatus(MARKETPLACES.MERCADO_LIBRE, 'shipped'),
    ORDER_STATUSES.SHIPPED,
  );
});

const parisCases = [
  ['ready_to_ship', ORDER_STATUSES.PENDING],
  ['printed_label', ORDER_STATUSES.PENDING],
  ['shipped', ORDER_STATUSES.SHIPPED],
  ['cd_in_progress', ORDER_STATUSES.SHIPPED],
  ['delivery_in_progress', ORDER_STATUSES.SHIPPED],
  ['delivery_with_problems', ORDER_STATUSES.SHIPPED],
  ['available_at_pickup', ORDER_STATUSES.SHIPPED],
  ['available_at_store', ORDER_STATUSES.SHIPPED],
  ['client_changed_address', ORDER_STATUSES.SHIPPED],
  ['delivered', ORDER_STATUSES.DELIVERED],
  ['cancelled', ORDER_STATUSES.CANCELED],
  ['stock_shortage_refunded', ORDER_STATUSES.CANCELED],
  ['returned_to_seller', ORDER_STATUSES.RETURNED],
] as const;

for (const [externalStatus, expectedStatus] of parisCases) {
  test(`Paris: ${externalStatus} -> ${expectedStatus}`, () => {
    assert.equal(normalizeParisOrderStatus(externalStatus), expectedStatus);
  });
}

test('El normalizador general selecciona el mapeador de Paris', () => {
  assert.equal(
    normalizeOrderStatus(MARKETPLACES.PARIS, 'delivered'),
    ORDER_STATUSES.DELIVERED,
  );
});

test('Paris mantiene recibida una devolucion parcial', () => {
  assert.equal(
    resolveParisOrderStatus('returned_to_seller', [
      ORDER_STATUSES.DELIVERED,
      ORDER_STATUSES.RETURNED,
    ]),
    ORDER_STATUSES.DELIVERED,
  );
});

test('Paris marca devuelta una devolucion total', () => {
  assert.equal(
    resolveParisOrderStatus('delivered', [
      ORDER_STATUSES.RETURNED,
      ORDER_STATUSES.RETURNED,
    ]),
    ORDER_STATUSES.RETURNED,
  );
});

const ripleyCases = [
  ['STAGING', ORDER_STATUSES.PENDING],
  ['WAITING_ACCEPTANCE', ORDER_STATUSES.PENDING],
  ['WAITING_DEBIT', ORDER_STATUSES.PENDING],
  ['WAITING_REFUND', ORDER_STATUSES.PENDING],
  ['SHIPPING', ORDER_STATUSES.PENDING],
  ['SHIPPED', ORDER_STATUSES.SHIPPED],
  ['TO_COLLECT', ORDER_STATUSES.SHIPPED],
  ['RECEIVED', ORDER_STATUSES.DELIVERED],
  ['CLOSED', ORDER_STATUSES.DELIVERED],
  ['REFUSED', ORDER_STATUSES.CANCELED],
  ['CANCELED', ORDER_STATUSES.CANCELED],
  ['REFUNDED', ORDER_STATUSES.CANCELED],
] as const;

for (const [externalStatus, expectedStatus] of ripleyCases) {
  test(`Ripley: ${externalStatus} -> ${expectedStatus}`, () => {
    assert.equal(normalizeRipleyOrderStatus(externalStatus), expectedStatus);
  });
}

test('El normalizador general selecciona el mapeador de Ripley', () => {
  assert.equal(
    normalizeOrderStatus(MARKETPLACES.RIPLEY, 'RECEIVED'),
    ORDER_STATUSES.DELIVERED,
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
