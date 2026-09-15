import assert from 'node:assert/strict';
import test from 'node:test';
import {
  falabellaItemsAreReadyForInvoice,
  getFalabellaMissingOrderItemIds,
  getFalabellaInvoiceType,
  getFalabellaRetryOrderItemIds,
  isParisRepeatedInvoiceError,
} from '../src/app/lib/invoices/invoice-upload-utils.ts';

test('Falabella usa el tipo tributario real de la orden', () => {
  assert.equal(getFalabellaInvoiceType('boleta'), 'BOLETA');
  assert.equal(getFalabellaInvoiceType('factura'), 'FACTURA');
  assert.equal(getFalabellaInvoiceType(' FACTURA '), 'FACTURA');
});

test('Falabella rechaza tipos desconocidos antes de subir', () => {
  assert.throws(() => getFalabellaInvoiceType('nota_credito'));
});

test('Falabella extrae los OrderItemId que su API declara inexistentes', () => {
  const errorData = {
    ErrorResponse: {
      Body: {
        errors: [{
          title: {
            en: 'OrderItem(s) not found: 38387450,38387453, 38387451',
            es: 'No se encontraron elementos de pedido: 38387450,38387453, 38387451',
          },
        }],
      },
    },
  };

  assert.deepEqual(
    getFalabellaMissingOrderItemIds(errorData),
    ['38387450', '38387453', '38387451'],
  );
});

test('Falabella reintenta solo con los identificadores que no rechazó', () => {
  assert.deepEqual(
    getFalabellaRetryOrderItemIds(
      ['38387450', '38387453', '38387451', '38387455'],
      { title: { en: 'OrderItem(s) not found: 38387450,38387453,38387451' } },
    ),
    ['38387455'],
  );
});

test('Falabella no inventa un reintento para otros errores', () => {
  assert.deepEqual(
    getFalabellaRetryOrderItemIds(
      ['38387450', '38387455'],
      { title: { en: 'Invalid seller order item status' } },
    ),
    [],
  );
});

test('Falabella espera hasta que todos los ítems estén listos para facturar', () => {
  assert.equal(falabellaItemsAreReadyForInvoice([{ Status: 'pending' }]), false);
  assert.equal(
    falabellaItemsAreReadyForInvoice([
      { Status: 'ready_to_ship' },
      { Status: 'SHIPPED' },
      { Status: 'delivered' },
    ]),
    true,
  );
  assert.equal(falabellaItemsAreReadyForInvoice([{ Status: 'canceled' }]), false);
});

test('París reconoce solamente la respuesta INVOICE_REPEATED', () => {
  assert.equal(
    isParisRepeatedInvoiceError({ message: 'INVOICE_REPEATED', statusCode: 500 }),
    true,
  );
  assert.equal(isParisRepeatedInvoiceError({ message: 'INVALID_FILE' }), false);
  assert.equal(isParisRepeatedInvoiceError(null), false);
});
