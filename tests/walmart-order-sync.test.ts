import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectWalmartReturnSummaries,
  expandWalmartOrderLineUnits,
  findWalmartFiscalSignals,
  getWalmartDeliveryDate,
  getWalmartLineProductTotal,
  getWalmartMarketplaceItemId,
  getWalmartShippingAmount,
  getWalmartUnitPrice,
  normalizeWalmartCursor,
  normalizeWalmartReturnStatus,
  resolveWalmartExistingHeaderStatus,
  resolveWalmartOrderStatus,
} from '../src/app/lib/walmart/order-sync.ts';
import { ORDER_STATUSES as STATUS } from '../src/app/lib/orders/order-status.ts';

const baseLine = {
  lineNumber: '1',
  item: { productName: 'Producto Walmart', sku: 'SKU-1' },
  charges: {
    charge: [
      {
        chargeType: 'PRODUCT',
        chargeName: 'ItemPrice',
        chargeAmount: { currency: 'CLP', amount: 16798 },
        tax: { taxAmount: { currency: 'CLP', amount: 3192 } },
      },
    ],
  },
  orderLineQuantity: { amount: '1' },
  orderLineStatuses: {
    orderLineStatus: [{ status: 'Delivered', statusQuantity: { amount: '1' } }],
  },
};

test('Walmart calcula precio bruto unitario sin sumar comisiones', () => {
  const line = {
    ...baseLine,
    charges: {
      charge: [
        ...baseLine.charges.charge,
        {
          chargeType: 'COMMISSION',
          chargeName: 'Commission',
          chargeAmount: { amount: 2999 },
        },
      ],
    },
  };
  assert.equal(getWalmartLineProductTotal(line), 19990);
  assert.equal(getWalmartUnitPrice(line), 19990);
});

test('Walmart resta descuentos de producto y divide el total por cantidad', () => {
  const line = {
    ...baseLine,
    charges: {
      charge: [
        {
          chargeType: 'PRODUCT',
          chargeName: 'ItemPrice',
          chargeAmount: { amount: 30000 },
          tax: { taxAmount: { amount: 5700 } },
        },
        {
          chargeType: 'DISCOUNT',
          chargeName: 'DISCOUNT',
          chargeAmount: { amount: 5700 },
        },
      ],
    },
    orderLineQuantity: { amount: 3 },
  };
  assert.equal(getWalmartLineProductTotal(line), 30000);
  assert.equal(getWalmartUnitPrice(line), 10000);
});

test('Walmart calcula el despacho pagado descontando SHIP_DISC', () => {
  const order = {
    orderLines: {
      orderLine: [
        {
          ...baseLine,
          charges: {
            charge: [
              { chargeType: 'SHIPPING', chargeName: 'Shipping', chargeAmount: { amount: 2513 }, tax: { taxAmount: { amount: 477 } } },
              { chargeType: 'DISCOUNT', chargeName: 'SHIP_DISC', chargeAmount: { amount: 2990 } },
            ],
          },
        },
      ],
    },
  };
  assert.equal(getWalmartShippingAmount(order), 0);
});

test('Walmart usa estimatedDeliveryDate en Chile sin sumar dias', () => {
  assert.equal(
    getWalmartDeliveryDate({
      shippingInfo: {
        estimatedDeliveryDate: 1780567200000,
        estimatedShipDate: 1780336800000,
      },
    }),
    '2026-06-04',
  );
});

test('Walmart usa estimatedShipDate solo como fallback real', () => {
  assert.equal(
    getWalmartDeliveryDate({ shippingInfo: { estimatedShipDate: 1780336800000 } }),
    '2026-06-01',
  );
});

test('Walmart identifica de forma estable la linea y sus unidades', () => {
  assert.equal(getWalmartMarketplaceItemId('P111', '2'), 'P111:2');
  assert.equal(getWalmartMarketplaceItemId('P111', '2', 1), 'P111:2:unit:2');
});

test('Walmart resuelve cantidades con estados mixtos desde el estado mas reciente', () => {
  const items = expandWalmartOrderLineUnits('P111', {
    ...baseLine,
    orderLineQuantity: { amount: 3 },
    orderLineStatuses: {
      orderLineStatus: [
        { status: 'Acknowledged', statusQuantity: { amount: 3 } },
        { status: 'Cancelled', statusQuantity: { amount: 1 } },
      ],
    },
  }, 0);
  assert.deepEqual(
    items.map((item) => item.status),
    [STATUS.CANCELED, STATUS.PENDING, STATUS.PENDING],
  );
});

test('Return INITIATED no marca el producto devuelto', () => {
  const summaries = collectWalmartReturnSummaries([{ returnOrderLines: [{
    purchaseOrderId: 'P111',
    purchaseOrderLineNumber: '1',
    status: 'RETURN_INITIATED',
    quantity: { amount: 1 },
  }] }]);
  const [item] = expandWalmartOrderLineUnits('P111', baseLine, 0, summaries);
  assert.equal(item.status, STATUS.DELIVERED);
  assert.equal(item.marketplaceStatus, 'RETURN_INITIATED');
});

test('Return COMPLETED marca solo la cantidad devuelta', () => {
  const summaries = collectWalmartReturnSummaries([{ returnOrderLines: [{
    purchaseOrderId: 'P111',
    purchaseOrderLineNumber: '1',
    status: 'RETURN_COMPLETED',
    quantity: { amount: 1 },
  }] }]);
  const items = expandWalmartOrderLineUnits('P111', {
    ...baseLine,
    orderLineQuantity: { amount: 3 },
    orderLineStatuses: {
      orderLineStatus: [{ status: 'Delivered', statusQuantity: { amount: 3 } }],
    },
  }, 0, summaries);
  assert.deepEqual(
    items.map((item) => item.status),
    [STATUS.RETURNED, STATUS.DELIVERED, STATUS.DELIVERED],
  );
  assert.equal(items[0].productQuantity, 1);
});

test('Return CANCELLED conserva el estado logistico', () => {
  assert.equal(normalizeWalmartReturnStatus('RETURN_CANCELLED'), 'cancelled');
  const summaries = collectWalmartReturnSummaries([{ returnOrderLines: [{
    purchaseOrderId: 'P111',
    purchaseOrderLineNumber: '1',
    status: 'RETURN_CANCELLED',
    quantity: { amount: 1 },
  }] }]);
  const [item] = expandWalmartOrderLineUnits('P111', baseLine, 0, summaries);
  assert.equal(item.status, STATUS.DELIVERED);
});

test('Walmart calcula devolucion parcial y total en cabecera', () => {
  assert.equal(
    resolveWalmartOrderStatus([STATUS.RETURNED, STATUS.DELIVERED]),
    STATUS.DELIVERED,
  );
  assert.equal(
    resolveWalmartOrderStatus([STATUS.RETURNED, STATUS.RETURNED]),
    STATUS.RETURNED,
  );
});

test('Walmart resuelve Delivered y Cancelled como recibido', () => {
  assert.equal(
    resolveWalmartOrderStatus([STATUS.DELIVERED, STATUS.CANCELED]),
    STATUS.DELIVERED,
  );
});

test('Una orden Walmart existente no retrocede', () => {
  assert.deepEqual(
    resolveWalmartExistingHeaderStatus(STATUS.DELIVERED, STATUS.SHIPPED),
    { status: STATUS.DELIVERED, accepted: false },
  );
});

test('Cursor Walmart acepta el formato retornado por ambas APIs', () => {
  assert.equal(normalizeWalmartCursor('?limit=200&offset=200'), 'limit=200&offset=200');
  assert.equal(normalizeWalmartCursor('cursor=abc'), 'cursor=abc');
  assert.equal(normalizeWalmartCursor('-1'), null);
  assert.equal(normalizeWalmartCursor(null), null);
});

test('KYC se detecta para diagnostico pero no implica factura', () => {
  const signals = findWalmartFiscalSignals({
    kycDetails: { kycIdType: 'RFC', kycIdValue: '12.345.678-9' },
  });
  assert.ok(signals.includes('kycDetails'));
  assert.ok(signals.includes('kycIdValue'));
});
