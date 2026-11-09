import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateQuotationTotals } from '../src/app/lib/quotes/calculations.ts';
import { createQuotationPdf } from '../src/app/lib/quotes/pdf.ts';
import { parseQuotationInput } from '../src/app/lib/quotes/validation.ts';
import type { Quotation } from '../src/app/lib/quotes/definitions.ts';
import { PDFDocument } from 'pdf-lib';

test('calcula descuento e IVA cuando los precios son netos', () => {
  const totals = calculateQuotationTotals({
    items: [
      { quantity: 30, unitPrice: 20_526 },
      { quantity: 30, unitPrice: 21_745 },
    ],
    pricesIncludeVat: false,
    vatRate: 0.19,
    discountType: 'percent',
    discountValue: 5,
  });

  assert.deepEqual(totals, {
    subtotal: 1_268_130,
    discount: 63_406.5,
    net: 1_204_723.5,
    vat: 228_897.47,
    total: 1_433_620.97,
  });
});

test('separa neto e IVA cuando el precio unitario ya incluye IVA', () => {
  const totals = calculateQuotationTotals({
    items: [{ quantity: 30, unitPrice: 59_000 }],
    pricesIncludeVat: true,
    vatRate: 0.19,
  });

  assert.deepEqual(totals, {
    subtotal: 1_770_000,
    discount: 0,
    net: 1_487_394.96,
    vat: 282_605.04,
    total: 1_770_000,
  });
});

test('valida los campos mínimos de una cotización', () => {
  const input = parseQuotationInput({
    customer: { legalName: 'Centro de Eventos Sofia Jottar' },
    quoteDate: '2026-11-09',
    pricesIncludeVat: true,
    items: [{ description: 'Mantel negro 3 x 3 m', quantity: 30, unitPrice: 59_000 }],
  });

  assert.equal(input.customer.legalName, 'Centro de Eventos Sofia Jottar');
  assert.equal(input.items[0].unit, 'unidad');
  assert.equal(input.vatRate, 0.19);
});

test('rechaza cotizaciones sin ítems', () => {
  assert.throws(() => parseQuotationInput({
    customer: { legalName: 'Cliente' },
    quoteDate: '2026-11-09',
    items: [],
  }), /Agrega al menos un producto/);
});

test('genera un PDF legible desde una cotización guardada', async () => {
  const quotation: Quotation = {
    id: '00000000-0000-4000-8000-000000000001',
    quoteNumber: '22023-254',
    sequenceNumber: 254,
    customer: {
      id: '00000000-0000-4000-8000-000000000002',
      legalName: 'Centro de Eventos y Banquetería Sofia Jottar',
      rut: null,
      contactName: null,
      email: null,
      phone: null,
      address: null,
      city: null,
      notes: null,
    },
    quoteDate: '2026-11-09',
    validUntil: null,
    deliveryDate: '2026-11-14',
    deliveryNote: 'Entrega coordinada en horario de mañana.',
    status: 'draft',
    currency: 'CLP',
    pricesIncludeVat: true,
    vatRate: 0.19,
    discountType: 'none',
    discountValue: 0,
    paymentTerms: 'Transferencia bancaria.',
    notes: null,
    totals: calculateQuotationTotals({
      items: [{ quantity: 30, unitPrice: 59_000 }],
      pricesIncludeVat: true,
    }),
    items: [{
      id: '00000000-0000-4000-8000-000000000003',
      catalogProductId: null,
      catalogVariantId: null,
      sortOrder: 1,
      description: 'Mantel para mesa de tela color negro, gabardina, 3 m x 3 m',
      quantity: 30,
      unit: 'unidad',
      unitPrice: 59_000,
      lineTotal: 1_770_000,
    }],
    createdAt: '2026-11-09T12:00:00.000Z',
    updatedAt: '2026-11-09T12:00:00.000Z',
  };

  const bytes = await createQuotationPdf(quotation);
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 1);
  assert.ok(bytes.length > 5_000);
});

