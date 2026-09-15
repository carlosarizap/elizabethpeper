import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import {
  canMarkMercadoLibreShipmentReady,
  composeLetterLabelPdf,
  getMercadoLibreSlaDeadline,
  getMercadoLibreLabelEligibility,
  isMercadoLibreShipmentWaitingForLabel,
} from '../src/app/lib/mercadolibre/shipping-label-utils.ts';

test('habilita etiquetas listas de Mercado Envíos 2', () => {
  assert.deepEqual(
    getMercadoLibreLabelEligibility({
      status: 'ready_to_ship',
      substatus: 'ready_to_print',
      mode: 'me2',
      logisticType: 'drop_off',
    }),
    { eligible: true, reason: null },
  );
});

test('extrae únicamente la fecha comprometida del SLA', () => {
  assert.equal(
    getMercadoLibreSlaDeadline({ expected_date: '2026-09-15T16:00:00-03:00' }),
    '2026-09-15T16:00:00-03:00',
  );
  assert.equal(getMercadoLibreSlaDeadline({ code: 'not_found' }), null);
});

test('mantiene disponible una etiqueta ya impresa para reimpresión', () => {
  assert.equal(
    getMercadoLibreLabelEligibility({
      status: 'ready_to_ship',
      substatus: 'printed',
      mode: 'me2',
      logisticType: 'cross_docking',
    }).eligible,
    true,
  );
});

test('rechaza modalidades y estados no imprimibles', () => {
  assert.equal(getMercadoLibreLabelEligibility(null).eligible, false);
  assert.equal(
    getMercadoLibreLabelEligibility({
      status: 'shipped',
      substatus: 'printed',
      mode: 'me2',
      logisticType: 'drop_off',
    }).eligible,
    false,
  );
  assert.equal(
    getMercadoLibreLabelEligibility({
      status: 'ready_to_ship',
      substatus: 'ready_to_print',
      mode: 'me2',
      logisticType: 'fulfillment',
    }).eligible,
    false,
  );
  assert.equal(
    getMercadoLibreLabelEligibility({
      status: 'ready_to_ship',
      substatus: 'ready_to_print',
      mode: 'not_specified',
      logisticType: null,
    }).eligible,
    false,
  );
});

test('distingue stock en preparación de una etiqueta imprimible', () => {
  const manufacturing = {
    status: 'pending',
    substatus: 'manufacturing',
    mode: 'me2',
    logisticType: 'xd_drop_off',
  };

  assert.equal(getMercadoLibreLabelEligibility(manufacturing).eligible, false);
  assert.equal(isMercadoLibreShipmentWaitingForLabel(manufacturing), true);
  assert.equal(canMarkMercadoLibreShipmentReady(manufacturing), true);

  const generatingLabel = {
    ...manufacturing,
    status: 'handling',
    substatus: 'waiting_for_label_generation',
  };
  assert.equal(isMercadoLibreShipmentWaitingForLabel(generatingLabel), true);
  assert.equal(canMarkMercadoLibreShipmentReady(generatingLabel), false);
});

test('compone todas las páginas en tamaño carta', async () => {
  const first = await PDFDocument.create();
  first.addPage([595, 842]).drawRectangle({ x: 10, y: 10, width: 50, height: 50 });
  first.addPage([300, 500]).drawRectangle({ x: 10, y: 10, width: 50, height: 50 });
  const second = await PDFDocument.create();
  second.addPage([612, 792]).drawRectangle({ x: 10, y: 10, width: 50, height: 50 });

  const result = await composeLetterLabelPdf([
    await first.save(),
    await second.save(),
  ]);
  const document = await PDFDocument.load(result);

  assert.equal(document.getPageCount(), 3);
  for (const page of document.getPages()) {
    assert.deepEqual(page.getSize(), { width: 612, height: 792 });
  }
});

test('usa carta horizontal solo para documentos marcados como Mercado Libre', async () => {
  const mercadoLibre = await PDFDocument.create();
  mercadoLibre.addPage([842, 595]).drawRectangle({
    x: 10,
    y: 10,
    width: 822,
    height: 575,
  });
  const otherMarketplace = await PDFDocument.create();
  otherMarketplace.addPage([842, 595]).drawRectangle({
    x: 10,
    y: 10,
    width: 822,
    height: 575,
  });

  const result = await composeLetterLabelPdf([
    { bytes: await mercadoLibre.save(), orientation: 'landscape' },
    await otherMarketplace.save(),
  ]);
  const document = await PDFDocument.load(result);

  assert.deepEqual(document.getPage(0).getSize(), { width: 792, height: 612 });
  assert.deepEqual(document.getPage(1).getSize(), { width: 612, height: 792 });
});
