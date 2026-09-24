import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import {
  composeWalmartLabelsWithProductSummaryPdf,
  getWalmartAcknowledgePath,
  getWalmartCurrentStatuses,
  getWalmartLabelGroups,
  getWalmartLabelEligibility,
  getWalmartTrackingNumbers,
  prepareWalmartShippingLabelPdfs,
} from '../src/app/lib/walmart/shipping-labels.ts';
import type { WalmartOrder } from '../src/app/lib/walmart/order-sync.ts';

function orderWithStatuses(
  statuses: Array<{ status: string; trackingNumber?: string }>,
): WalmartOrder {
  return {
    purchaseOrderId: 'P100',
    orderLines: {
      orderLine: statuses.map((entry, index) => ({
        lineNumber: String(index + 1),
        orderLineQuantity: { amount: '1', unitOfMeasurement: 'EACH' },
        orderLineStatuses: {
          orderLineStatus: [{
            status: entry.status,
            statusQuantity: { amount: '1' },
            trackingInfo: entry.trackingNumber
              ? { trackingNumber: entry.trackingNumber }
              : undefined,
          }],
        },
      })),
    },
  };
}

test('Walmart Chile aprueba líneas mediante el endpoint Global 3.1', () => {
  assert.equal(
    getWalmartAcknowledgePath('P100/CL'),
    '/v3/orders/P100%2FCL/acknowledgeLines',
  );
});

test('Walmart aprueba automáticamente las órdenes Created', () => {
  assert.deepEqual(
    getWalmartLabelEligibility(orderWithStatuses([
      { status: 'Created' },
      { status: 'Created' },
    ])),
    { eligible: true, shouldAcknowledge: true, reason: null },
  );
});

test('Walmart permite reimprimir una orden ya Acknowledged sin aprobarla otra vez', () => {
  assert.deepEqual(
    getWalmartLabelEligibility(orderWithStatuses([{ status: 'Acknowledged' }])),
    { eligible: true, shouldAcknowledge: false, reason: null },
  );
});

test('Walmart excluye órdenes enviadas o terminadas', () => {
  const eligibility = getWalmartLabelEligibility(
    orderWithStatuses([{ status: 'Delivered', trackingNumber: 'TRACK-1' }]),
  );
  assert.equal(eligibility.eligible, false);
  assert.match(eligibility.reason ?? '', /DELIVERED/);
});

test('Walmart obtiene estados actuales y números de seguimiento sin duplicarlos', () => {
  const order = orderWithStatuses([
    { status: 'Acknowledged', trackingNumber: 'TRACK-1' },
    { status: 'Acknowledged', trackingNumber: 'TRACK-1' },
    { status: 'Acknowledged', trackingNumber: 'TRACK-2' },
  ]);
  assert.deepEqual(getWalmartCurrentStatuses(order), [
    'Acknowledged',
    'Acknowledged',
    'Acknowledged',
  ]);
  assert.deepEqual(getWalmartTrackingNumbers(order), ['TRACK-1', 'TRACK-2']);
});

test('Walmart asocia cada seguimiento a una unidad y a su producto', () => {
  const order: WalmartOrder = {
    purchaseOrderId: 'P100',
    orderLines: {
      orderLine: [
        {
          lineNumber: '1',
          item: { productName: 'Cojín azul', sku: 'AZUL' },
          orderLineStatuses: {
            orderLineStatus: [{
              status: 'Acknowledged',
              trackingInfo: { trackingNumber: 'TRACK-1' },
            }],
          },
        },
        {
          lineNumber: '2',
          item: { productName: 'Cojín rojo', sku: 'ROJO' },
          orderLineStatuses: {
            orderLineStatus: [{
              status: 'Acknowledged',
              trackingInfo: { trackingNumber: 'TRACK-2' },
            }],
          },
        },
      ],
    },
  };

  assert.deepEqual(getWalmartLabelGroups(order), [
    { trackingNumbers: ['TRACK-1'], productSummary: '1 - Cojín azul' },
    { trackingNumbers: ['TRACK-2'], productSummary: '1 - Cojín rojo' },
  ]);
});

test('Walmart no intenta imprimir cuando no informa estados', () => {
  const eligibility = getWalmartLabelEligibility({
    purchaseOrderId: 'P100',
    orderLines: { orderLine: [{ lineNumber: '1' }] },
  });
  assert.equal(eligibility.eligible, false);
  assert.match(eligibility.reason ?? '', /estado actual/);
});

test('Walmart espera si el tracking existe pero el PDF todavía se está generando', async () => {
  const originalFetch = globalThis.fetch;
  const originalClientId = process.env.WALMART_CLIENT_ID;
  const originalClientSecret = process.env.WALMART_CLIENT_SECRET;
  let labelAttempts = 0;
  process.env.WALMART_CLIENT_ID = 'client-test';
  process.env.WALMART_CLIENT_SECRET = 'secret-test';

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/v3/token')) {
      return Response.json({ access_token: 'token-test', expires_in: 900 });
    }
    if (url.endsWith('/v3/orders/P100')) {
      return Response.json({
        order: {
          purchaseOrderId: 'P100',
          orderLines: {
            orderLine: [{
              lineNumber: '1',
              item: { productName: 'Cojín de prueba', sku: 'SKU-1' },
              orderLineStatuses: {
                orderLineStatus: [{
                  status: 'Acknowledged',
                  trackingInfo: { trackingNumber: 'TRACK-1' },
                }],
              },
            }],
          },
        },
      });
    }
    if (url.endsWith('/v3/orders/labels')) {
      labelAttempts += 1;
      if (labelAttempts === 1) {
        return Response.json(
          { message: 'label is still being generated' },
          { status: 409, headers: { 'retry-after': '0' } },
        );
      }
      return new Response(new TextEncoder().encode('%PDF-1.4\n% walmart label'), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
    }
    return new Response(null, { status: 404 });
  };

  try {
    const result = await prepareWalmartShippingLabelPdfs('P100');

    assert.equal(labelAttempts, 2);
    assert.equal(result.documents.length, 1);
    assert.equal(result.documents[0].productSummary, '1 - Cojín de prueba');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalClientId === undefined) delete process.env.WALMART_CLIENT_ID;
    else process.env.WALMART_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.WALMART_CLIENT_SECRET;
    else process.env.WALMART_CLIENT_SECRET = originalClientSecret;
  }
});

test('Walmart distribuye cuatro etiquetas con contenido unitario por hoja carta', async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]).drawRectangle({
    x: 20,
    y: 20,
    width: 572,
    height: 752,
  });

  const document = await source.save();
  const result = await composeWalmartLabelsWithProductSummaryPdf(
    Array.from({ length: 4 }, (_, index) => ({
      document,
      orderId: `12345678${index}`,
      productSummary: `1 - Producto ${index + 1}`,
    })),
  );
  const output = await PDFDocument.load(result);

  assert.equal(output.getPageCount(), 1);
  assert.deepEqual(output.getPage(0).getSize(), { width: 612, height: 792 });
});
