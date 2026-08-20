import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildShopifyUpdatedAtSearch,
  calculateShopifyFallbackDeliveryDate,
  collectShopifyCursorPages,
  collectShopifyReturnSummaries,
  expandShopifyLineItemUnits,
  getShopifyDeliveryDate,
  getShopifyMarketplaceItemId,
  getShopifyShippingAmount,
  getShopifyUnitPrice,
  normalizeShopifyOrder,
  resolveShopifyExistingHeaderStatus,
  resolveShopifyOrderStatus,
  toSantiagoDate,
  toShopifyOrderGid,
  toShopifyOrderId,
} from '../src/app/lib/shopify/order-sync.ts';
import { ORDER_STATUSES as STATUS } from '../src/app/lib/orders/order-status.ts';

const line = {
  id: 'gid://shopify/LineItem/10',
  title: 'Producto Shopify',
  quantity: 1,
  currentQuantity: 1,
  unfulfilledQuantity: 1,
  discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: '9990' } },
};

const order = {
  id: 'gid://shopify/Order/123456',
  name: '#1071',
  createdAt: '2026-08-14T23:30:00Z',
  displayFulfillmentStatus: 'UNFULFILLED',
  totalShippingPriceSet: { shopMoney: { amount: '3990' } },
  currentShippingPriceSet: { shopMoney: { amount: '0' } },
  lineItems: { nodes: [line] },
  fulfillments: [],
  refunds: [],
};

test('Shopify conserva el formato historico de order_id y resuelve su GID', () => {
  assert.equal(toShopifyOrderId(order.id, order.name), '#1071-123456');
  assert.equal(toShopifyOrderGid('#1071-123456'), order.id);
  assert.equal(toShopifyOrderGid(order.id), order.id);
});

test('sincronizacion Shopify filtra por updated_at', () => {
  assert.equal(
    buildShopifyUpdatedAtSearch(4, new Date('2026-08-18T12:00:00Z')),
    'updated_at:>=2026-08-14T12:00:00.000Z',
  );
});

test('paginacion Shopify recorre endCursor hasta terminar', async () => {
  const cursors: Array<string | null> = [];
  const result = await collectShopifyCursorPages(async (cursor) => {
    cursors.push(cursor);
    return cursor === null
      ? { nodes: ['A'], hasNextPage: true, endCursor: 'cursor-1' }
      : { nodes: ['B'], hasNextPage: false, endCursor: null };
  });
  assert.deepEqual(cursors, [null, 'cursor-1']);
  assert.deepEqual(result, { nodes: ['A', 'B'], pages: 2 });
});

test('Shopify usa el precio unitario posterior a todos los descuentos', () => {
  assert.equal(getShopifyUnitPrice({
    ...line,
    quantity: 3,
    discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: '8000' } },
    originalTotalSet: { shopMoney: { amount: '30000' } },
    totalDiscountSet: { shopMoney: { amount: '6000' } },
  }), 8000);
});

test('Shopify calcula precio descontado desde el total como fallback', () => {
  assert.equal(getShopifyUnitPrice({
    ...line,
    quantity: 3,
    discountedUnitPriceAfterAllDiscountsSet: null,
    discountedTotalSet: { shopMoney: { amount: '24000' } },
  }), 8000);
});

test('Shopify conserva shipping original y no currentShippingPriceSet reembolsado', () => {
  assert.equal(getShopifyShippingAmount(order), 3990);
});

test('UNFULFILLED queda pendiente', () => {
  const normalized = normalizeShopifyOrder(order);
  assert.equal(normalized.status, STATUS.PENDING);
  assert.equal(normalized.items[0].status, STATUS.PENDING);
  assert.equal(normalized.items[0].productQuantity, 1);
});

test('Fulfillment SUCCESS sin entrega confirmada queda enviado', () => {
  const normalized = normalizeShopifyOrder({
    ...order,
    displayFulfillmentStatus: 'FULFILLED',
    lineItems: { nodes: [{ ...line, unfulfilledQuantity: 0 }] },
    fulfillments: [{
      status: 'SUCCESS',
      fulfillmentLineItems: { nodes: [{ quantity: 1, lineItem: { id: line.id } }] },
      events: { nodes: [] },
    }],
  });
  assert.equal(normalized.status, STATUS.SHIPPED);
  assert.equal(normalized.items[0].status, STATUS.SHIPPED);
});

test('deliveredAt confirma recibido', () => {
  const normalized = normalizeShopifyOrder({
    ...order,
    displayFulfillmentStatus: 'FULFILLED',
    fulfillments: [{
      status: 'SUCCESS',
      deliveredAt: '2026-08-18T02:30:00Z',
      fulfillmentLineItems: { nodes: [{ quantity: 1, lineItem: { id: line.id } }] },
      events: { nodes: [] },
    }],
  });
  assert.equal(normalized.status, STATUS.DELIVERED);
  assert.equal(normalized.items[0].status, STATUS.DELIVERED);
  assert.equal(normalized.deliveryDate, '2026-08-17');
});

test('evento DELIVERED confirma recibido', () => {
  const normalized = normalizeShopifyOrder({
    ...order,
    fulfillments: [{
      status: 'SUCCESS',
      fulfillmentLineItems: { nodes: [{ quantity: 1, lineItem: { id: line.id } }] },
      events: { nodes: [{ status: 'DELIVERED', happenedAt: '2026-08-18T15:00:00Z' }] },
    }],
  });
  assert.equal(normalized.items[0].status, STATUS.DELIVERED);
});

test('cancelledAt cancela unidades que nunca fueron despachadas', () => {
  const normalized = normalizeShopifyOrder({
    ...order,
    cancelledAt: '2026-08-15T12:00:00Z',
    displayFulfillmentStatus: 'RESTOCKED',
  });
  assert.equal(normalized.status, STATUS.CANCELED);
  assert.equal(normalized.items[0].status, STATUS.CANCELED);
});

for (const returnStatus of ['REQUESTED', 'OPEN', 'DECLINED', 'CANCELED']) {
  test(`Return ${returnStatus} conserva estado logistico`, () => {
    const [item] = expandShopifyLineItemUnits({
      ...order,
      fulfillments: [{
        status: 'SUCCESS',
        deliveredAt: '2026-08-17T12:00:00Z',
        fulfillmentLineItems: { nodes: [{ quantity: 1, lineItem: { id: line.id } }] },
      }],
      returns: { nodes: [{
        status: returnStatus,
        returnLineItems: { nodes: [{
          __typename: 'ReturnLineItem',
          quantity: 1,
          processedQuantity: 0,
          fulfillmentLineItem: { lineItem: { id: line.id } },
        }] },
      }] },
    }, line, 0);
    assert.equal(item.status, STATUS.DELIVERED);
    assert.equal(item.marketplaceStatus, `RETURN_${returnStatus}`);
  });
}

test('Return CLOSED marca solamente processedQuantity', () => {
  const threeUnits = { ...line, quantity: 3, currentQuantity: 3, unfulfilledQuantity: 0 };
  const shopifyOrder = {
    ...order,
    lineItems: { nodes: [threeUnits] },
    fulfillments: [{
      status: 'SUCCESS',
      deliveredAt: '2026-08-17T12:00:00Z',
      fulfillmentLineItems: { nodes: [{ quantity: 3, lineItem: { id: line.id } }] },
    }],
    returns: { nodes: [{
      status: 'CLOSED',
      returnLineItems: { nodes: [{
        __typename: 'ReturnLineItem',
        quantity: 1,
        processedQuantity: 1,
        fulfillmentLineItem: { lineItem: { id: line.id } },
      }] },
    }] },
  };
  const summaries = collectShopifyReturnSummaries(shopifyOrder.returns.nodes);
  const items = expandShopifyLineItemUnits(shopifyOrder, threeUnits, 0, summaries);
  assert.deepEqual(items.map((item) => item.status), [
    STATUS.RETURNED,
    STATUS.DELIVERED,
    STATUS.DELIVERED,
  ]);
  assert.deepEqual(items.map((item) => item.marketplaceItemId), [
    line.id,
    `${line.id}:unit:2`,
    `${line.id}:unit:3`,
  ]);
});

test('Shopify calcula devolucion parcial y total desde unidades separadas', () => {
  assert.equal(resolveShopifyOrderStatus([STATUS.RETURNED, STATUS.DELIVERED]), STATUS.DELIVERED);
  assert.equal(resolveShopifyOrderStatus([STATUS.RETURNED, STATUS.RETURNED]), STATUS.RETURNED);
});

test('refund sin Return no se interpreta como devolucion fisica', () => {
  const [item] = expandShopifyLineItemUnits({
    ...order,
    fulfillments: [{
      status: 'SUCCESS',
      deliveredAt: '2026-08-17T12:00:00Z',
      fulfillmentLineItems: { nodes: [{ quantity: 1, lineItem: { id: line.id } }] },
    }],
    refunds: [{
      refundLineItems: { nodes: [{
        quantity: 1,
        restockType: 'RETURN',
        lineItem: { id: line.id },
      }] },
    }],
  }, line, 0);
  assert.equal(item.status, STATUS.DELIVERED);
  assert.equal(item.marketplaceStatus, 'REFUND_RETURN_UNLINKED');
});

test('refund CANCEL antes del despacho queda cancelado', () => {
  const [item] = expandShopifyLineItemUnits({
    ...order,
    refunds: [{
      refundLineItems: { nodes: [{
        quantity: 1,
        restockType: 'CANCEL',
        lineItem: { id: line.id },
      }] },
    }],
  }, line, 0);
  assert.equal(item.status, STATUS.CANCELED);
});

test('Shopify usa fecha estimada real en America/Santiago', () => {
  assert.equal(toSantiagoDate('2026-08-20T02:30:00Z'), '2026-08-19');
  assert.equal(getShopifyDeliveryDate({
    ...order,
    fulfillments: [{ estimatedDeliveryAt: '2026-08-20T02:30:00Z' }],
  }), '2026-08-19');
});

test('fecha fallback suma un dia habil sin desfase UTC', () => {
  assert.equal(calculateShopifyFallbackDeliveryDate('2026-08-14T23:30:00Z'), '2026-08-17');
});

test('IDs de unidades Shopify no se duplican', () => {
  assert.deepEqual(
    [0, 1, 2].map((index) => getShopifyMarketplaceItemId(line.id, index)),
    [line.id, `${line.id}:unit:2`, `${line.id}:unit:3`],
  );
});

test('una orden Shopify existente no retrocede', () => {
  assert.deepEqual(
    resolveShopifyExistingHeaderStatus(STATUS.DELIVERED, STATUS.SHIPPED),
    { status: STATUS.DELIVERED, accepted: false },
  );
});
