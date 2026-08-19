import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getParisDeliveryDate,
  getParisDocumentType,
  getParisInvoiceData,
  getParisMarketplaceItemId,
  getParisShippingAmount,
  getParisRawStatus,
  resolveParisExistingHeaderState,
} from '../src/app/lib/paris/order-sync.ts';
import { MARKETPLACES } from '../src/app/lib/constants/marketplaces.ts';
import {
  normalizeMarketplaceOrderItemStatus,
  STANDARD_ORDER_ITEM_STATUSES as ITEM,
} from '../src/app/lib/orders/order-item-status.ts';

test('Paris obtiene RUT y ciudad reales para una factura', () => {
  const order = {
    originInvoiceType: 'factura',
    businessInvoice: {
      companyRut: '12.345.678-k',
      comuna: 'Santiago',
    },
  };

  assert.equal(getParisDocumentType(order), 'factura');
  assert.deepEqual(getParisInvoiceData(order), {
    companyRut: '12345678-K',
    billingCity: 'Santiago',
  });
});

test('Paris mantiene una boleta sin datos fiscales', () => {
  const order = { originInvoiceType: 'boleta' };
  assert.equal(getParisDocumentType(order), 'boleta');
  assert.deepEqual(getParisInvoiceData(order), {
    companyRut: null,
    billingCity: null,
  });
});

test('Paris usa el id estable de cada unidad, incluso con el mismo SKU', () => {
  const first = getParisMarketplaceItemId({ id: 'uuid-1', sellerSku: 'SKU-1' }, 0);
  const second = getParisMarketplaceItemId({ id: 'uuid-2', sellerSku: 'SKU-1' }, 1);
  assert.equal(first, 'uuid-1');
  assert.equal(second, 'uuid-2');
  assert.notEqual(first, second);
});

test('Paris usa SKU y posicion solo como fallback del id', () => {
  assert.equal(
    getParisMarketplaceItemId({ sellerSku: 'SKU-1', position: 2 }, 0),
    'SKU-1:2',
  );
});

test('Paris usa la fecha de entrega al courier y costo del payload v1', () => {
  const subOrder = {
    effectiveArrivalDate: '2026-08-17T16:10:00.000Z',
    arrivalDate: '2026-08-16T00:00:00.000Z',
    dispatchDate: '2026-08-15T00:00:00.000Z',
    cost: '4990',
  };
  assert.equal(getParisDeliveryDate(subOrder), '2026-08-15');
  assert.equal(getParisShippingAmount(subOrder), 4990);
});

test('Paris no suma un dia a dispatchDate', () => {
  assert.equal(
    getParisDeliveryDate({ dispatchDate: '2026-08-15T15:00:00.000Z' }),
    '2026-08-15',
  );
});

test('Paris usa arrivalDate solo cuando no existe dispatchDate', () => {
  assert.equal(
    getParisDeliveryDate({ arrivalDate: '2026-08-20T00:00:00.000Z' }),
    '2026-08-20',
  );
});

test('Un returnId por si solo no marca la unidad como devuelta', () => {
  const item = {
    returnId: 12345,
    status: { name: 'delivered' },
  };
  assert.equal(
    normalizeMarketplaceOrderItemStatus(
      MARKETPLACES.PARIS,
      getParisRawStatus(item.status),
    ),
    ITEM.DELIVERED,
  );
});

test('Solo el estado final returned marca la unidad como devuelta', () => {
  const item = {
    returnId: 12345,
    status: { name: 'returned' },
  };
  assert.equal(
    normalizeMarketplaceOrderItemStatus(
      MARKETPLACES.PARIS,
      getParisRawStatus(item.status),
    ),
    ITEM.RETURNED,
  );
});

test('El upsert de una orden existente evita regresion y permite completar factura', () => {
  assert.deepEqual(
    resolveParisExistingHeaderState(
      'recibido',
      'boleta',
      false,
      'pendiente',
      'factura',
    ),
    {
      status: 'recibido',
      documentType: 'factura',
      statusWasAccepted: false,
    },
  );
});
