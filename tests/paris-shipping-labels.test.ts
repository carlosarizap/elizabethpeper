import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import {
  composeParisLabelsLetterGridPdf,
  downloadParisShippingLabelPdfs,
  resolveParisShippingAccessToken,
} from '../src/app/lib/paris/shipping-labels.ts';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.4\n% test label');

test('París conserva el token derivado y admite API key si el intercambio responde 401', async () => {
  assert.equal(await resolveParisShippingAccessToken(async () => 'derived', 'key'), 'derived');
  assert.equal(await resolveParisShippingAccessToken(async () => {
    throw Object.assign(new Error('Unauthorized'), { response: { status: 401 } });
  }, 'key'), 'key');
  await assert.rejects(resolveParisShippingAccessToken(async () => {
    throw Object.assign(new Error('Unavailable'), { response: { status: 503 } });
  }, 'key'), /Unavailable/);
});

test('París recupera la etiqueta exacta por v1 con API key si shipments rechaza la autenticación', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    if (url.includes('/v2/shipments/')) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    if (url.includes('/v1/orders?')) {
      assert.equal(new URL(url).searchParams.get('sellerId'), 'seller');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer api-key');
      return Response.json({ data: [{ subOrders: [
        { subOrderNumber: 'OTHER', labelId: 'WRONG' },
        { subOrderNumber: '3160267881', labelId: 'EXACT' },
      ] }] });
    }
    if (url.endsWith('/v1/sub-orders/EXACT/print-label')) {
      return Response.json({ data: [{ labels: 'https://labels.example/fallback.pdf', url: 'https://labels.example/fallback.pdf' }] });
    }
    if (url === 'https://labels.example/fallback.pdf') return new Response(PDF_BYTES);
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const documents = await downloadParisShippingLabelPdfs('3160267881', 'token', { apiKey: 'api-key', sellerId: 'seller' });
    assert.equal(documents.length, 1);
    assert.ok(!requests.some((url) => url.includes('WRONG')));
    assert.equal(requests.filter((url) => url === 'https://labels.example/fallback.pdf').length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('París no imprime una orden diferente si la búsqueda alternativa no devuelve la solicitada', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).includes('/v2/shipments/')
    ? Response.json({ message: 'Unauthorized' }, { status: 403 })
    : Response.json({ data: [{ subOrders: [{ subOrderNumber: 'OTHER', labelId: 'WRONG' }] }] });
  try {
    await assert.rejects(downloadParisShippingLabelPdfs('3160267881', 'token', { apiKey: 'key', sellerId: 'seller' }), /todavía no generó/);
  } finally { globalThis.fetch = originalFetch; }
});

test('París usa la etiqueta unitaria para un envío de un paquete', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.endsWith('/v2/shipments/3135545160')) {
      return Response.json([{ labelId: 'QA7X9ZGV2L', nPackages: 1 }]);
    }
    if (url.endsWith('/v1/sub-orders/QA7X9ZGV2L/print-label')) {
      return Response.json({ data: [{ labels: 'https://labels.example/unit.pdf' }] });
    }
    if (url === 'https://labels.example/unit.pdf') {
      return new Response(PDF_BYTES, { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    return new Response(null, { status: 404 });
  };

  try {
    const documents = await downloadParisShippingLabelPdfs('3135545160', 'derived-token');
    assert.equal(documents.length, 1);
    assert.equal(new TextDecoder().decode(documents[0]), '%PDF-1.4\n% test label');
    assert.ok(requestedUrls.some((url) => url.endsWith('/v1/sub-orders/QA7X9ZGV2L/print-label')));
    assert.ok(!requestedUrls.some((url) => url.includes('/v2/label/print-label/')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('París usa la ruta multitracking cuando el envío tiene varios paquetes', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.endsWith('/v2/shipments/3135705191')) {
      return Response.json([{ labelId: 'MULTI123', nPackages: 2 }]);
    }
    if (url.endsWith('/v2/label/print-label/MULTI123')) {
      return Response.json({ data: { url: 'https://labels.example/multi.pdf' } });
    }
    if (url === 'https://labels.example/multi.pdf') {
      return new Response(PDF_BYTES, { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    return new Response(null, { status: 404 });
  };

  try {
    const documents = await downloadParisShippingLabelPdfs('3135705191', 'derived-token');
    assert.equal(documents.length, 1);
    assert.ok(requestedUrls.some((url) => url.endsWith('/v2/label/print-label/MULTI123')));
    assert.ok(!requestedUrls.some((url) => url.includes('/v1/sub-orders/MULTI123/print-label')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('París reintenta automáticamente un 503 temporal del balanceador', async () => {
  const originalFetch = globalThis.fetch;
  let shipmentAttempts = 0;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/v2/shipments/3136482280')) {
      shipmentAttempts += 1;
      if (shipmentAttempts < 3) {
        return Response.json(
          { message: 'failure to get a peer from the ring-balancer' },
          { status: 503, headers: { 'retry-after': '0' } },
        );
      }
      return Response.json([{ labelId: 'RETRY123', nPackages: 1 }]);
    }
    if (url.endsWith('/v1/sub-orders/RETRY123/print-label')) {
      return Response.json({ data: [{ labels: 'https://labels.example/retry.pdf' }] });
    }
    if (url === 'https://labels.example/retry.pdf') {
      return new Response(PDF_BYTES, { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    return new Response(null, { status: 404 });
  };

  try {
    const documents = await downloadParisShippingLabelPdfs('3136482280', 'derived-token');

    assert.equal(shipmentAttempts, 3);
    assert.equal(documents.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('París espera cuando la etiqueta responde 409 mientras se publica', async () => {
  const originalFetch = globalThis.fetch;
  let labelAttempts = 0;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/v2/shipments/3142102340')) {
      return Response.json([{ labelId: 'PUBLISHING123', nPackages: 1 }]);
    }
    if (url.endsWith('/v1/sub-orders/PUBLISHING123/print-label')) {
      labelAttempts += 1;
      if (labelAttempts === 1) {
        return Response.json(
          { message: 'label is still being generated' },
          { status: 409, headers: { 'retry-after': '0' } },
        );
      }
      return Response.json({ data: [{ labels: 'https://labels.example/published.pdf' }] });
    }
    if (url === 'https://labels.example/published.pdf') {
      return new Response(PDF_BYTES, { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    return new Response(null, { status: 404 });
  };

  try {
    const documents = await downloadParisShippingLabelPdfs('3142102340', 'derived-token');

    assert.equal(labelAttempts, 2);
    assert.equal(documents.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('París compone cuatro etiquetas en una sola hoja carta', async () => {
  const documents: Uint8Array[] = [];
  for (let index = 0; index < 4; index += 1) {
    const source = await PDFDocument.create();
    source.addPage([612, 792]).drawRectangle({
      x: 180,
      y: 320,
      width: 250,
      height: 280,
    });
    documents.push(await source.save());
  }

  const result = await composeParisLabelsLetterGridPdf(documents.map((document, index) => ({
    document,
    orderId: `313570000${index}`,
    productSummary: '2 - Juego de Sábanas 1 Plaza\n1 - Funda de Cojín',
  })));
  const output = await PDFDocument.load(result);

  assert.equal(output.getPageCount(), 1);
  assert.deepEqual(output.getPage(0).getSize(), { width: 612, height: 792 });
});
