import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { planWcpPackages, prepareWcpLabels, type StoredWcpLabel, type WcpDependencies, type WcpPackage, type WalmartPackageInput } from '../src/app/lib/walmart/wcp-labels.ts';
import { readMercadoLibrePackaging, suggestGroupedPackages, suggestProductPackaging } from '../src/app/lib/walmart/packaging.ts';
import type { WalmartOrder } from '../src/app/lib/walmart/order-sync.ts';
import { composeWalmartLabelsWithProductSummaryPdf } from '../src/app/lib/walmart/shipping-labels.ts';

const order: WalmartOrder = { purchaseOrderId: 'WCP-1', isWCPOrder: true, orderLines: { orderLine: [
  { lineNumber: '1', item: { sku: 'CAM7', productName: 'Camino de mesa 180x33' }, orderLineQuantity: { amount: '6' } },
] } };
const packaging = { lengthCm: 30, widthCm: 22, heightCm: 12, weightKg: 1.8, source: 'measured' };
const input: WalmartPackageInput[] = [{ items: [{ lineNumber: '1', quantity: 6 }], packaging }];
type TestRemoteLabel = { trackingNo: string; boxItems: WcpPackage['request']['boxItems'] };

async function harness() {
  const pdf = await PDFDocument.create();
  pdf.addPage([283.46, 425.2]).drawText('Shipping label');
  const bytes = await pdf.save();
  const rows: StoredWcpLabel[] = [];
  const calls: Array<{ path: string; body?: WcpPackage['request'] }> = [];
  let fail = false;
  let remote: TestRemoteLabel[] = [];
  const deps: WcpDependencies = {
    request: async (path, init) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (!init?.method) return Response.json({ data: remote });
      if (fail) throw new Error('Connection closed after sending request');
      return Response.json({ data: { trackingNo: 'TRACK-' + calls.length, boxItems: JSON.parse(String(init.body)).boxItems,
        shippingDocuments: [{ documentFormat: 'PDF', documentType: 'LABEL', base64EncodedDocument: Buffer.from(bytes).toString('base64') }] } });
    },
    download: async () => bytes,
    store: {
      list: async () => structuredClone(rows),
      savePlan: async (plan) => { rows.splice(0, rows.length, ...plan.map((p) => ({ ...p, status: 'planned' as const, trackingNumber: null, document: null }))); },
      start: async (key) => { rows.find((r) => r.key === key)!.status = 'creating'; },
      ready: async (pkg, trackingNumber, document) => {
        const row = rows.find((r) => r.key === pkg.key)!;
        Object.assign(row, { status: 'ready', trackingNumber, document });
      },
      fail: async (key, status) => { rows.find((r) => r.key === key)!.status = status; },
    },
  };
  return { deps, rows, calls, bytes, setFail: (value: boolean) => { fail = value; }, setRemote: (value: TestRemoteLabel[]) => { remote = value; } };
}

test('agrupa seis telas en un bulto y propone varios para cojines grandes', () => {
  const folded = suggestProductPackaging('Camino de mesa 180x33 cm', 0.3)!;
  const flat = suggestGroupedPackages([{ lineNumber: '1', quantity: 6, packaging: folded }]);
  assert.equal(flat.length, 1);
  assert.equal(flat[0].items[0].quantity, 6);
  assert.deepEqual(flat[0].packaging, { ...packaging, source: 'agrupacion_sugerida' });
  const pillows = suggestGroupedPackages([{ lineNumber: '1', quantity: 6, packaging: suggestProductPackaging('Cojín 60x60 con relleno') }]);
  assert.equal(pillows.length, 2);
  assert.deepEqual(pillows.map((p) => p.items[0].quantity), [3, 3]);
});

test('lee embalaje Mercado Libre con conversión de gramos y metros; no usa medidas del producto', () => {
  const attributes = [['SELLER_PACKAGE_LENGTH', '0.3 m'], ['SELLER_PACKAGE_WIDTH', '22 cm'], ['SELLER_PACKAGE_HEIGHT', '20 mm'], ['SELLER_PACKAGE_WEIGHT', '300 g']]
    .map(([id, value_name]) => ({ id, value_name }));
  assert.deepEqual(readMercadoLibrePackaging({ attributes }), { lengthCm: 30, widthCm: 22, heightCm: 2, weightKg: 0.3, source: 'mercado_libre' });
  assert.equal(readMercadoLibrePackaging({ attributes: [{ id: 'LENGTH', value_name: '180 cm' }] }), null);
});

test('valida reparto exacto, medidas y líneas antes de crear etiquetas', () => {
  assert.equal(planWcpPackages(order, input)[0].request.boxItems[0].quantity, 6);
  assert.throws(() => planWcpPackages(order, [{ ...input[0], items: [{ lineNumber: '1', quantity: 5 }] }]), /exactamente/);
  assert.throws(() => planWcpPackages(order, [{ ...input[0], packaging: { ...packaging, weightKg: 0 } }]), /mayores/);
  assert.throws(() => planWcpPackages(order, [{ ...input[0], items: [{ lineNumber: '9', quantity: 6 }] }]), /inválidas/);
});

test('crea una etiqueta agrupada y la reimprime sin nuevas llamadas aunque JSONB reordene campos', async () => {
  const h = await harness();
  const first = await prepareWcpLabels(order, h.deps, input);
  assert.equal(first.length, 1);
  assert.equal(first[0].productSummary, '6 - Camino de mesa 180x33');
  const sent = h.calls.find((c) => c.body)!.body;
  assert.deepEqual(sent.boxDimensions, { boxDimensionUnit: 'CM', boxWeightUnit: 'KG', boxLength: 30, boxWidth: 22, boxHeight: 12, boxWeight: 1.8 });
  h.rows[0].request = Object.fromEntries(Object.entries(h.rows[0].request).reverse()) as typeof h.rows[0]['request'];
  const calls = h.calls.length;
  assert.equal((await prepareWcpLabels(order, h.deps, input)).length, 1);
  assert.equal(h.calls.length, calls);
});

test('un timeout queda pendiente de conciliación y no repite el POST al reintentar', async () => {
  const h = await harness(); h.setFail(true);
  await assert.rejects(prepareWcpLabels(order, h.deps, input), /Connection closed/);
  assert.equal(h.rows[0].status, 'uncertain');
  h.setFail(false);
  await assert.rejects(prepareWcpLabels(order, h.deps), /sin confirmar/);
  assert.equal(h.calls.filter((c) => c.body).length, 1);
  h.setRemote([{ trackingNo: 'RECOVERED', boxItems: [{ lineNumber: '1', sku: 'CAM7', quantity: 6 }] }]);
  assert.equal((await prepareWcpLabels(order, h.deps)).length, 1);
  assert.equal(h.rows[0].trackingNumber, 'RECOVERED');
  assert.equal(h.calls.filter((c) => c.body).length, 1);
});

test('rechaza una agrupación remota distinta antes de aceptar o mutar la orden', async () => {
  const h = await harness(); let acknowledged = false;
  h.deps.acknowledge = async () => { acknowledged = true; };
  h.setRemote([{ trackingNo: 'OLD', boxItems: [{ lineNumber: '1', sku: 'CAM7', quantity: 1 }] }]);
  await assert.rejects(prepareWcpLabels(order, h.deps, input), /otro agrupamiento/);
  assert.equal(acknowledged, false);
  assert.equal(h.rows.length, 0);
});

test('un plan iniciado impide cambiar contenido o medidas y permite completar varios bultos', async () => {
  const h = await harness();
  const split = [{ items: [{ lineNumber: '1', quantity: 3 }], packaging }, { items: [{ lineNumber: '1', quantity: 3 }], packaging }];
  await prepareWcpLabels(order, h.deps, split);
  assert.equal(h.rows.length, 2);
  await assert.rejects(prepareWcpLabels(order, h.deps, input), /guardado/);
});

test('un rechazo definitivo permite corregir las medidas antes de crear el envío', async () => {
  const h = await harness();
  const request = h.deps.request;
  h.deps.request = async (path, init, accept) => init?.method
    ? Response.json({ message: 'Invalid weight' }, { status: 400 }) : request(path, init, accept);
  await assert.rejects(prepareWcpLabels(order, h.deps, input), /Invalid weight/);
  assert.equal(h.rows[0].status, 'failed');
  h.deps.request = request;
  const corrected = [{ ...input[0], packaging: { ...packaging, weightKg: 2 } }];
  await prepareWcpLabels(order, h.deps, corrected);
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].status, 'ready');
  assert.equal(h.rows[0].request.boxDimensions.boxWeight, 2);
});

test('recupera un lote parcialmente creado sin repetir la etiqueta del primer bulto', async () => {
  const h = await harness();
  const request = h.deps.request;
  let posts = 0;
  h.deps.request = async (path, init, accept) => {
    if (init?.method && ++posts === 2) throw new Error('Connection interrupted');
    return request(path, init, accept);
  };
  const split = [1, 2].map(() => ({ items: [{ lineNumber: '1', quantity: 3 }], packaging }));
  await assert.rejects(prepareWcpLabels(order, h.deps, split), /interrupted/);
  assert.deepEqual(h.rows.map((r) => r.status), ['ready', 'uncertain']);
  h.setRemote([{ trackingNo: 'SECOND', boxItems: [{ lineNumber: '1', sku: 'CAM7', quantity: 3 }] }]);
  assert.equal((await prepareWcpLabels(order, h.deps)).length, 2);
  assert.equal(posts, 2);
});

test('la etiqueta WCP conserva la página completa en su propia hoja carta', async () => {
  const h = await harness();
  const result = await composeWalmartLabelsWithProductSummaryPdf([
    { document: h.bytes, orderId: 'WCP-1', productSummary: '6 - Caminos', fullPage: true },
    { document: h.bytes, orderId: 'WCP-2', productSummary: '1 - Cojín', fullPage: true },
  ]);
  const pdf = await PDFDocument.load(result);
  assert.equal(pdf.getPageCount(), 2);
  assert.equal(pdf.getPage(0).getWidth(), 612);
});

test('las etiquetas WCP domésticas se agrupan de cuatro por hoja con su contenido', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([288, 576]);
  page.drawText('Carrier label', { x: 16, y: 550 });
  page.drawText('Walmart', { x: 16, y: 340 });
  page.drawText('Integration metadata', { x: 16, y: 290 });
  const document = await source.save();
  const result = await composeWalmartLabelsWithProductSummaryPdf(Array.from({ length: 5 }, (_, index) => ({
    document, orderId: `WCP-${index}`, productSummary: '6 - Caminos', fullPage: true,
  })));
  const pdf = await PDFDocument.load(result);
  assert.equal(pdf.getPageCount(), 2);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 612, height: 792 });
});
