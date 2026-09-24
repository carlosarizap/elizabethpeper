import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import {
  composeParisLabelsLetterGridPdf,
  downloadParisShippingLabelPdfs,
} from '../src/app/lib/paris/shipping-labels.ts';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.4\n% test label');

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
