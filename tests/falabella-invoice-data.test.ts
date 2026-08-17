import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getFalabellaBillingCity,
  getFalabellaCompanyRut,
  getFalabellaInvoiceData,
  normalizeChileanRut,
  preserveExistingInvoiceValue,
} from '../src/app/lib/falabella/invoice-data.ts';

test('utiliza LegalId vÃ¡lido antes que NationalRegistrationNumber', () => {
  assert.equal(
    getFalabellaCompanyRut({
      ExtraBillingAttributes: { LegalId: '12.345.678-k' },
      NationalRegistrationNumber: '13.340.473-2',
    }),
    '12345678-K',
  );
});

test('utiliza NationalRegistrationNumber cuando LegalId estÃ¡ vacÃ­o', () => {
  assert.equal(
    getFalabellaCompanyRut({
      ExtraBillingAttributes: { LegalId: '' },
      NationalRegistrationNumber: '13.340.473-2',
    }),
    '13340473-2',
  );
});

test('normaliza puntos, espacios y k minÃºscula del RUT', () => {
  assert.equal(normalizeChileanRut(' 12.345.678-k '), '12345678-K');
});

test('agrega el guion cuando el marketplace entrega RUT solo con digitos', () => {
  assert.equal(normalizeChileanRut('123456785'), '12345678-5');
});

test('un RUT vacÃ­o o marcador nulo produce null', () => {
  assert.equal(normalizeChileanRut(''), null);
  assert.equal(normalizeChileanRut('-'), null);
  assert.equal(normalizeChileanRut('null'), null);
  assert.equal(normalizeChileanRut('undefined'), null);
});

test('utiliza ReceiverLocality antes que las demÃ¡s ciudades', () => {
  assert.equal(
    getFalabellaBillingCity({
      ExtraBillingAttributes: {
        ReceiverLocality: 'Melipilla',
        ReceiverMunicipality: 'Santiago',
      },
      AddressBilling: { City: 'Providencia' },
    }),
    'Melipilla',
  );
});

test('utiliza ReceiverMunicipality cuando ReceiverLocality estÃ¡ vacÃ­o', () => {
  assert.equal(
    getFalabellaBillingCity({
      ExtraBillingAttributes: {
        ReceiverLocality: '',
        ReceiverMunicipality: 'Santiago',
      },
    }),
    'Santiago',
  );
});

test('utiliza AddressBilling.City cuando los datos adicionales estÃ¡n vacÃ­os', () => {
  assert.equal(
    getFalabellaBillingCity({
      ExtraBillingAttributes: {
        ReceiverLocality: '',
        ReceiverMunicipality: '-',
      },
      AddressBilling: { City: 'MELIPILLA' },
    }),
    'MELIPILLA',
  );
});

test('utiliza AddressShipping.City cuando la facturaciÃ³n estÃ¡ vacÃ­a', () => {
  assert.equal(
    getFalabellaBillingCity({
      AddressBilling: { City: '', Ward: '' },
      AddressShipping: { City: 'Talagante' },
    }),
    'Talagante',
  );
});

test('todos los campos de ciudad vacÃ­os producen null', () => {
  assert.equal(
    getFalabellaBillingCity({
      ExtraBillingAttributes: {
        ReceiverLocality: '',
        ReceiverMunicipality: 'null',
      },
      AddressBilling: { City: '-', Ward: 'undefined' },
      AddressShipping: { City: '', Ward: '' },
    }),
    null,
  );
});

test('extrae el ejemplo completo esperado', () => {
  assert.deepEqual(
    getFalabellaInvoiceData({
      NationalRegistrationNumber: '13.340.473-2',
      AddressBilling: { City: 'MELIPILLA', Ward: 'MELIPILLA' },
      ExtraBillingAttributes: {
        LegalId: '',
        ReceiverLocality: '',
        ReceiverMunicipality: '',
      },
    }),
    { companyRut: '13340473-2', billingCity: 'MELIPILLA' },
  );
});

test('una actualizaciÃ³n null conserva el valor existente', () => {
  assert.equal(preserveExistingInvoiceValue('13340473-2', null), '13340473-2');
  assert.equal(preserveExistingInvoiceValue('MELIPILLA', null), 'MELIPILLA');
});
