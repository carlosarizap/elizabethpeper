import assert from 'node:assert/strict';
import test from 'node:test';
import { MARKETPLACES } from '../src/app/lib/constants/marketplaces.ts';
import {
  calculateOrderReturnStatus,
  normalizeMarketplaceOrderItemStatus,
  resolveOrderItemStatusTransition,
  STANDARD_ORDER_ITEM_STATUSES as ITEM,
  STANDARD_ORDER_RETURN_STATUSES as RETURN,
} from '../src/app/lib/orders/order-item-status.ts';

const normalizationCases = [
  ['pending', ITEM.PENDING],
  ['ready_To_Ship', ITEM.PENDING],
  ['READY_TO_SHIP', ITEM.PENDING],
  ['shipped', ITEM.SHIPPED],
  ['delivered', ITEM.DELIVERED],
  ['failed', ITEM.CANCELED],
  ['canceled', ITEM.CANCELED],
  ['cancelled', ITEM.CANCELED],
  ['returned', ITEM.RETURNED],
  ['RETURNED', ITEM.RETURNED],
  ['return_waiting_for_approval', ITEM.DELIVERED],
  ['return_shipped_by_customer', ITEM.DELIVERED],
  ['return_rejected', ITEM.DELIVERED],
] as const;

for (const [rawStatus, expected] of normalizationCases) {
  test(`Estado de Ã­tem Falabella: ${rawStatus} -> ${expected}`, () => {
    assert.equal(
      normalizeMarketplaceOrderItemStatus(MARKETPLACES.FALABELLA, rawStatus),
      expected,
    );
  });
}

test('Un detalle nuevo usa pendiente cuando el estado es nulo', () => {
  assert.equal(
    normalizeMarketplaceOrderItemStatus(MARKETPLACES.FALABELLA, null),
    ITEM.PENDING,
  );
});

const mercadoLibreItemCases = [
  ['paid', ITEM.PENDING],
  ['ready_to_ship', ITEM.PENDING],
  ['shipped', ITEM.SHIPPED],
  ['delivered', ITEM.DELIVERED],
  ['cancelled', ITEM.CANCELED],
  ['not_delivered', ITEM.CANCELED],
  ['partially_refunded', ITEM.PENDING],
] as const;

for (const [rawStatus, expected] of mercadoLibreItemCases) {
  test(`Estado de item Mercado Libre: ${rawStatus} -> ${expected}`, () => {
    assert.equal(
      normalizeMarketplaceOrderItemStatus(MARKETPLACES.MERCADO_LIBRE, rawStatus),
      expected,
    );
  });
}

const parisItemCases = [
  ['ready_to_ship', ITEM.PENDING],
  ['printed_label', ITEM.PENDING],
  ['shipped', ITEM.SHIPPED],
  ['available_at_store', ITEM.SHIPPED],
  ['delivered', ITEM.DELIVERED],
  ['cancelled', ITEM.CANCELED],
  ['stock_shortage_refunded', ITEM.CANCELED],
  ['returned', ITEM.RETURNED],
] as const;

for (const [rawStatus, expected] of parisItemCases) {
  test(`Estado de item Paris: ${rawStatus} -> ${expected}`, () => {
    assert.equal(
      normalizeMarketplaceOrderItemStatus(MARKETPLACES.PARIS, rawStatus),
      expected,
    );
  });
}

test('Un estado desconocido no reemplaza un estado actual mÃ¡s avanzado', () => {
  const incoming = normalizeMarketplaceOrderItemStatus(
    MARKETPLACES.FALABELLA,
    'estado_nuevo',
  );
  assert.equal(resolveOrderItemStatusTransition(ITEM.DELIVERED, incoming), ITEM.DELIVERED);
});

const transitionCases = [
  [ITEM.PENDING, ITEM.SHIPPED, ITEM.SHIPPED],
  [ITEM.SHIPPED, ITEM.DELIVERED, ITEM.DELIVERED],
  [ITEM.DELIVERED, ITEM.RETURNED, ITEM.RETURNED],
  [ITEM.RETURNED, ITEM.DELIVERED, ITEM.RETURNED],
  [ITEM.DELIVERED, ITEM.SHIPPED, ITEM.DELIVERED],
  [ITEM.CANCELED, ITEM.PENDING, ITEM.CANCELED],
  [ITEM.CANCELED, ITEM.RETURNED, ITEM.RETURNED],
] as const;

for (const [current, incoming, expected] of transitionCases) {
  test(`TransiciÃ³n de Ã­tem ${current} + ${incoming} -> ${expected}`, () => {
    assert.equal(resolveOrderItemStatusTransition(current, incoming), expected);
  });
}

test('Resumen sin devoluciÃ³n', () => {
  assert.equal(calculateOrderReturnStatus([ITEM.DELIVERED, ITEM.DELIVERED]), RETURN.NONE);
});

test('Resumen de devoluciÃ³n parcial', () => {
  assert.equal(calculateOrderReturnStatus([ITEM.DELIVERED, ITEM.RETURNED]), RETURN.PARTIAL);
});

test('Resumen de devoluciÃ³n total', () => {
  assert.equal(calculateOrderReturnStatus([ITEM.RETURNED, ITEM.RETURNED]), RETURN.TOTAL);
});

test('Un pedido sin detalles no se considera devolucion total', () => {
  assert.equal(calculateOrderReturnStatus([]), RETURN.NONE);
});
