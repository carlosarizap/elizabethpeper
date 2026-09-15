import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractReturnShippingStatuses,
  getMercadoLibreInvoiceData,
  getMercadoLibreMarketplaceItemId,
  inferMercadoLibreDocumentType,
  getMercadoLibreDeliveryDateSource,
  isMercadoLibreFulfillmentShipment,
  isCertainFullLineReturn,
  isMercadoLibreReturnClaim,
  predictMercadoLibreDispatchDeadline,
  resolveMercadoLibreDispatchDeadline,
} from '../src/app/lib/mercadolibre/order-sync.ts';

test('usa el SLA como plazo operativo y no la entrega estimada al comprador', () => {
  assert.equal(
    resolveMercadoLibreDispatchDeadline({
      slaExpectedDate: '2026-08-25T13:00:00-04:00',
      preparationDeadline: '2026-08-24T18:36:56-04:00',
    }),
    '2026-08-25T13:00:00-04:00',
  );
});

test('no confunde el plazo de preparación con el compromiso de despacho', () => {
  assert.equal(
    resolveMercadoLibreDispatchDeadline({
      slaExpectedDate: null,
      preparationDeadline: '2026-08-25T10:51:21-04:00',
    }),
    '2026-08-26T16:00:00-04:00',
  );
});

test('predice el despacho un día hábil antes de la entrega al comprador', () => {
  assert.equal(
    predictMercadoLibreDispatchDeadline({
      preparationDeadline: '2026-09-15T12:45:56-03:00',
      buyerDeliveryDate: '2026-09-17T00:00:00-03:00',
    }),
    '2026-09-16T16:00:00-03:00',
  );
  assert.equal(
    getMercadoLibreDeliveryDateSource({
      preparationDeadline: '2026-09-15T12:45:56-03:00',
      buyerDeliveryDate: '2026-09-17T00:00:00-03:00',
    }),
    'predicted',
  );
});

test('respeta días hábiles y distingue el SLA oficial', () => {
  assert.equal(
    predictMercadoLibreDispatchDeadline({
      preparationDeadline: '2026-09-20T12:00:00-03:00',
      buyerDeliveryDate: '2026-09-21T00:00:00-03:00',
    }),
    '2026-09-21T16:00:00-03:00',
  );
  assert.equal(
    getMercadoLibreDeliveryDateSource({
      slaExpectedDate: '2026-09-15T16:00:00-03:00',
      buyerDeliveryDate: '2026-09-16T00:00:00-03:00',
    }),
    'sla',
  );
});

test('una orden sin SLA no se confunde con Mercado Libre Full', () => {
  assert.equal(
    isMercadoLibreFulfillmentShipment([{ logisticType: 'xd_drop_off' }]),
    false,
  );
  assert.equal(
    isMercadoLibreFulfillmentShipment([{ logisticType: 'fulfillment' }]),
    true,
  );
});

test('extrae RUT y ciudad desde billing_info MLC', () => {
  const payload = {
    billing_info: {
      identification: { number: '77.312.865-0' },
      address: { city_name: 'Santiago' },
      attributes: { cust_type: 'BU' },
    },
  };

  assert.deepEqual(getMercadoLibreInvoiceData(payload), {
    companyRut: '77312865-0',
    billingCity: 'Santiago',
  });
  assert.equal(inferMercadoLibreDocumentType(payload), 'factura');
});

test('infiere factura cuando existe actividad economica', () => {
  assert.equal(
    inferMercadoLibreDocumentType({
      identification: { number: '77312865-0' },
      economic_activities: [{ code: '479100', name: 'Venta por internet' }],
    }),
    'factura',
  );
});

test('mantiene boleta para comprador consumidor', () => {
  assert.equal(
    inferMercadoLibreDocumentType({ attributes: { cust_type: 'CO' } }),
    'boleta',
  );
});

test('identificador de item conserva la variacion', () => {
  assert.equal(
    getMercadoLibreMarketplaceItemId({
      item: { id: 'MLC123' },
      variation_id: 456,
    }),
    'MLC123:456',
  );
});

test('extrae estados de formatos antiguo y nuevo de returns', () => {
  assert.deepEqual(
    extractReturnShippingStatuses([
      { shipping: { status: 'shipped' } },
      { status: 'pending_delivered', shipments: [{ status: 'delivered' }] },
    ]),
    ['shipped', 'pending_delivered', 'delivered'],
  );
});

test('identifica devoluciones por tipo o entidad relacionada', () => {
  assert.equal(isMercadoLibreReturnClaim({ type: 'return' }), true);
  assert.equal(
    isMercadoLibreReturnClaim({
      type: 'mediations',
      related_entities: ['return'],
    }),
    true,
  );
  assert.equal(
    isMercadoLibreReturnClaim({
      type: 'mediations',
      related_entities: [],
    }),
    false,
  );
});

test('solo acepta devolucion cierta de la linea completa', () => {
  assert.equal(
    isCertainFullLineReturn(
      { quantity_type: 'total', claimed_quantity: 2 },
      2,
      1,
    ),
    true,
  );
  assert.equal(
    isCertainFullLineReturn(
      { quantity_type: 'partial', claimed_quantity: 1 },
      2,
      1,
    ),
    false,
  );
  assert.equal(
    isCertainFullLineReturn(
      { quantity_type: 'total', claimed_quantity: 1 },
      2,
      1,
    ),
    false,
  );
});
