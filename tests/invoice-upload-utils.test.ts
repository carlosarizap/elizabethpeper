import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getFalabellaInvoiceType,
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

test('París reconoce solamente la respuesta INVOICE_REPEATED', () => {
  assert.equal(
    isParisRepeatedInvoiceError({ message: 'INVOICE_REPEATED', statusCode: 500 }),
    true,
  );
  assert.equal(isParisRepeatedInvoiceError({ message: 'INVALID_FILE' }), false);
  assert.equal(isParisRepeatedInvoiceError(null), false);
});
