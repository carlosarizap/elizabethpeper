import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import {
  composeWalmartLabelsWithProductSummaryPdf,
  getWalmartCurrentStatuses,
  getWalmartLabelEligibility,
  getWalmartTrackingNumbers,
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

test('Walmart no intenta imprimir cuando no informa estados', () => {
  const eligibility = getWalmartLabelEligibility({
    purchaseOrderId: 'P100',
    orderLines: { orderLine: [{ lineNumber: '1' }] },
  });
  assert.equal(eligibility.eligible, false);
  assert.match(eligibility.reason ?? '', /estado actual/);
});

test('Walmart agrega el contenido de la orden sin alterar el papel carta', async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]).drawRectangle({
    x: 20,
    y: 20,
    width: 572,
    height: 752,
  });

  const result = await composeWalmartLabelsWithProductSummaryPdf([{
    document: await source.save(),
    orderId: '123456789',
    productSummary: '2 - Funda de Cojín\n1 - Juego de Sábanas',
  }]);
  const output = await PDFDocument.load(result);

  assert.equal(output.getPageCount(), 1);
  assert.deepEqual(output.getPage(0).getSize(), { width: 612, height: 792 });
});
