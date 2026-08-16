import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractReturnShippingStatuses,
  getMercadoLibreInvoiceData,
  getMercadoLibreMarketplaceItemId,
  inferMercadoLibreDocumentType,
  isCertainFullLineReturn,
  isMercadoLibreReturnClaim,
} from '../src/app/lib/mercadolibre/order-sync.ts';

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
