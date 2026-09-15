import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import {
  composeFalabellaManifestLetterPdf,
  parseFalabellaManifestHtml,
} from '../src/app/lib/falabella/manifest-document.ts';

const MANIFEST_HTML = `
<html><body>
  <p>MFJB/TEST/20260915120000000</p>
  <p>Nombre vendedor: Elizabeth Peper E.I.R.L. &emsp; Número de registro de negocio: 773128650</p>
  <p>Proveedor de despacho: home delivery corp &emsp; Manifiesto del transportista impreso el: 15 Sep 2026</p>
  <table>
    <tr><th>Nº orden</th><th>Número de seguimiento</th><th>Cantidad de productos</th></tr>
    <tr><td>3251000001</td><td><p>140100000000000001</p></td><td>2</td></tr>
    <tr><td>3251000002</td><td><p>140100000000000002</p></td><td>1</td></tr>
  </table>
  <table><tr><th>Total de paquetes</th></tr><tr><td>2</td></tr></table>
</body></html>`;

test('extrae los datos del manifiesto oficial de Falabella', () => {
  const manifest = parseFalabellaManifestHtml(MANIFEST_HTML);

  assert.equal(manifest.manifestCode, 'MFJB/TEST/20260915120000000');
  assert.equal(manifest.sellerName, 'Elizabeth Peper E.I.R.L.');
  assert.equal(manifest.businessRegistrationNumber, '773128650');
  assert.equal(manifest.shippingProvider, 'home delivery corp');
  assert.equal(manifest.printedAt, '15 Sep 2026');
  assert.equal(manifest.totalPackages, 2);
  assert.deepEqual(manifest.rows, [
    { orderNumber: '3251000001', trackingNumber: '140100000000000001', productCount: 2 },
    { orderNumber: '3251000002', trackingNumber: '140100000000000002', productCount: 1 },
  ]);
});

test('convierte el manifiesto HTML de Falabella en una hoja carta PDF', async () => {
  const bytes = await composeFalabellaManifestLetterPdf(MANIFEST_HTML);
  const pdf = await PDFDocument.load(bytes);

  assert.equal(Buffer.from(bytes).subarray(0, 5).toString('ascii'), '%PDF-');
  assert.equal(pdf.getPageCount(), 1);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 612, height: 792 });
});
