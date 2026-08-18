import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeRipleyLineRefund,
  expandRipleyOrderLineUnits,
  findRipleyFiscalSignals,
  getRipleyDeliveryDate,
  getRipleyMarketplaceItemId,
  getRipleyShippingAmount,
  getRipleyUnitPrice,
  resolveRipleyExistingHeaderStatus,
  resolveRipleyHeaderStatus,
  resolveRipleyLineStatus,
} from '../src/app/lib/ripley/order-sync.ts';
import { ORDER_STATUSES as STATUS } from '../src/app/lib/orders/order-status.ts';

const completedRefund = {
  quantity: 1,
  amount: 14990,
  shipping_amount: 3990,
  created_date: '2026-08-10T15:00:00Z',
  reason_code: 'REFUND_Resp_seller',
  refund_state: 'REFUNDED',
  state: 'REFUNDED',
};

test('Ripley clasifica un refund completo antes de entregar como cancelado', () => {
  const line = { quantity: 1, refunds: [completedRefund] };
  assert.equal(
    resolveRipleyLineStatus(line, STATUS.CANCELED, STATUS.DELIVERED).status,
    STATUS.CANCELED,
  );
});

test('Ripley clasifica refund completo posterior a recepcion como devuelto', () => {
  const line = {
    quantity: 1,
    received_date: '2026-08-09T15:00:00Z',
    refunds: [completedRefund],
  };
  assert.equal(
    resolveRipleyLineStatus(line, STATUS.DELIVERED, STATUS.DELIVERED).status,
    STATUS.RETURNED,
  );
});

test('Un refund solo de despacho no devuelve el producto', () => {
  const line = {
    quantity: 1,
    received_date: '2026-08-09T15:00:00Z',
    refunds: [{ ...completedRefund, amount: 0, shipping_amount: 3990 }],
  };
  assert.equal(analyzeRipleyLineRefund(line).classification, 'none');
  assert.equal(
    resolveRipleyLineStatus(line, STATUS.DELIVERED, STATUS.DELIVERED).status,
    STATUS.DELIVERED,
  );
});

test('Un refund aun no finalizado no cambia el estado', () => {
  const line = {
    quantity: 1,
    refunds: [{ ...completedRefund, refund_state: 'WAITING_REFUND', state: 'WAITING_REFUND' }],
  };
  assert.equal(analyzeRipleyLineRefund(line).classification, 'none');
});

test('Cantidad parcialmente devuelta se divide en unidades sin emitir NC por toda la linea', () => {
  const line = {
    order_line_id: 'ORDER-A-1',
    quantity: 3,
    price: 45000,
    received_date: '2026-08-09T15:00:00Z',
    refunds: [{ ...completedRefund, quantity: 1 }],
  };
  const expanded = expandRipleyOrderLineUnits(
    line,
    0,
    STATUS.CANCELED,
    STATUS.DELIVERED,
  );

  assert.equal(expanded.refund.classification, 'partial_quantity');
  assert.equal(expanded.refund.refundedQuantity, 1);
  assert.equal(expanded.refund.returnedQuantity, 1);
  assert.equal(expanded.warning, null);
  assert.deepEqual(expanded.items, [
    {
      marketplaceItemId: 'ORDER-A-1',
      productQuantity: 1,
      productPrice: 15000,
      status: STATUS.RETURNED,
    },
    {
      marketplaceItemId: 'ORDER-A-1:unit:2',
      productQuantity: 1,
      productPrice: 15000,
      status: STATUS.DELIVERED,
    },
    {
      marketplaceItemId: 'ORDER-A-1:unit:3',
      productQuantity: 1,
      productPrice: 15000,
      status: STATUS.DELIVERED,
    },
  ]);
});

test('Cantidad parcialmente reembolsada antes de entregar cancela solo esas unidades', () => {
  const expanded = expandRipleyOrderLineUnits(
    {
      order_line_id: 'ORDER-B-1',
      quantity: 3,
      price: 30000,
      refunds: [{ ...completedRefund, quantity: 1 }],
    },
    0,
    STATUS.PENDING,
    STATUS.PENDING,
  );

  assert.deepEqual(
    expanded.items.map((item) => item.status),
    [STATUS.CANCELED, STATUS.PENDING, STATUS.PENDING],
  );
});

test('Ripley calcula devolucion parcial y total en la cabecera', () => {
  assert.equal(
    resolveRipleyHeaderStatus(STATUS.DELIVERED, [STATUS.DELIVERED, STATUS.RETURNED]),
    STATUS.DELIVERED,
  );
  assert.equal(
    resolveRipleyHeaderStatus(STATUS.DELIVERED, [STATUS.RETURNED, STATUS.RETURNED]),
    STATUS.RETURNED,
  );
});

test('Una orden existente no retrocede de recibido a enviado', () => {
  assert.deepEqual(
    resolveRipleyExistingHeaderStatus(STATUS.DELIVERED, STATUS.SHIPPED),
    { status: STATUS.DELIVERED, accepted: false },
  );
});

test('order_line_id es estable y evita identificar por titulo', () => {
  assert.equal(getRipleyMarketplaceItemId({ order_line_id: 'ORDER-A-1' }, 0), 'ORDER-A-1');
  assert.equal(getRipleyMarketplaceItemId({ order_line_id: 'ORDER-A-2' }, 1), 'ORDER-A-2');
});

test('Ripley calcula precio unitario y despacho del comprador', () => {
  assert.equal(getRipleyUnitPrice({ quantity: 2, price: 51180 }), 25590);
  assert.equal(getRipleyShippingAmount({ shipping_price: 8879 }), 8879);
});

test('Ripley prefiere delivery_date y luego commiteddate', () => {
  assert.equal(
    getRipleyDeliveryDate({
      delivery_date: '2026-08-20T16:00:00Z',
      created_date: '2026-08-17T10:00:00Z',
    }),
    '2026-08-20',
  );
  assert.equal(
    getRipleyDeliveryDate({
      delivery_date: null,
      created_date: '2026-08-17T10:00:00Z',
      order_additional_fields: [{ code: 'commiteddate', value: '2026-08-22T16:00:00Z' }],
    }),
    '2026-08-22',
  );
});

test('Ripley mantiene boleta al no encontrar campos fiscales explicitos', () => {
  assert.deepEqual(
    findRipleyFiscalSignals({
      order_additional_fields: [
        { code: 'commiteddate', value: '2026-08-22T16:00:00Z' },
        { code: 'storecode', value: 'CHEX' },
      ],
    }),
    [],
  );
});
