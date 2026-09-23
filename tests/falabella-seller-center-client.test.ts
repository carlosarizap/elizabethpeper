import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { calculateFalabellaSignature } from '../src/app/lib/falabella/signature-helper.ts';
import {
  createFalabellaForwardManifest,
  createFalabellaForwardManifestPdfs,
  markFalabellaOrderReadyToShip,
} from '../src/app/lib/falabella/seller-center-client.ts';

test('Falabella envía los parámetros firmados del POST en la URL', async () => {
  const originalFetch = globalThis.fetch;
  const originalUserId = process.env.FALABELLA_USER_ID;
  const originalApiKey = process.env.FALABELLA_API_KEY;
  let requestUrl = '';
  let requestOptions: RequestInit | undefined;

  process.env.FALABELLA_USER_ID = 'seller@example.com';
  process.env.FALABELLA_API_KEY = 'test-api-key';
  globalThis.fetch = async (input, options) => {
    requestUrl = String(input);
    requestOptions = options;
    return new Response(JSON.stringify({ SuccessResponse: { Body: {} } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await markFalabellaOrderReadyToShip(['10', '11'], {
      packageId: 'PKG123',
      shippingType: 'Dropshipping',
      shippingProvider: 'provider',
      trackingNumber: 'tracking',
    });

    const url = new URL(requestUrl);
    const signature = url.searchParams.get('Signature');
    assert.equal(requestOptions?.method, 'POST');
    assert.equal(requestOptions?.body, undefined);
    assert.equal(url.searchParams.get('Action'), 'SetStatusToReadyToShip');
    assert.equal(url.searchParams.get('OrderItemIds'), '[10,11]');
    assert.equal(url.searchParams.get('PackageId'), 'PKG123');
    assert.ok(signature);

    const signedParams = Object.fromEntries(url.searchParams.entries());
    delete signedParams.Signature;
    assert.equal(
      signature,
      calculateFalabellaSignature(signedParams, 'test-api-key'),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUserId === undefined) delete process.env.FALABELLA_USER_ID;
    else process.env.FALABELLA_USER_ID = originalUserId;
    if (originalApiKey === undefined) delete process.env.FALABELLA_API_KEY;
    else process.env.FALABELLA_API_KEY = originalApiKey;
  }
});

test('crea un manifiesto Falabella agrupando los ítems como texto XML', async () => {
  const originalFetch = globalThis.fetch;
  const originalUserId = process.env.FALABELLA_USER_ID;
  const originalApiKey = process.env.FALABELLA_API_KEY;
  let requestUrl = '';
  let requestOptions: RequestInit | undefined;

  process.env.FALABELLA_USER_ID = 'seller@example.com';
  process.env.FALABELLA_API_KEY = 'test-api-key';
  globalThis.fetch = async (input, options) => {
    requestUrl = String(input);
    requestOptions = options;
    return new Response(JSON.stringify({
      SuccessResponse: { Body: { Manifest: { ManifestId: 'MFJB/TEST/1' } } },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const manifestCodes = await createFalabellaForwardManifest(['10', '11', '10']);
    const url = new URL(requestUrl);

    assert.deepEqual(manifestCodes, ['MFJB/TEST/1']);
    assert.equal(url.searchParams.get('Action'), 'CreateForwardManifest');
    assert.equal(requestOptions?.method, 'POST');
    assert.equal(requestOptions?.headers && (requestOptions.headers as Record<string, string>)['content-type'], 'application/xml');
    assert.equal(
      requestOptions?.body,
      '<Request><OrderItemIds>10,11</OrderItemIds></Request>',
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUserId === undefined) delete process.env.FALABELLA_USER_ID;
    else process.env.FALABELLA_USER_ID = originalUserId;
    if (originalApiKey === undefined) delete process.env.FALABELLA_API_KEY;
    else process.env.FALABELLA_API_KEY = originalApiKey;
  }
});

test('conserva el código y mensaje de Falabella cuando el HTTP es 400', async () => {
  const originalFetch = globalThis.fetch;
  const originalUserId = process.env.FALABELLA_USER_ID;
  const originalApiKey = process.env.FALABELLA_API_KEY;

  process.env.FALABELLA_USER_ID = 'seller@example.com';
  process.env.FALABELLA_API_KEY = 'test-api-key';
  globalThis.fetch = async () => new Response(JSON.stringify({
    ErrorResponse: {
      Head: {
        ErrorCode: 'E034',
        ErrorMessage: 'All order items must be ready to ship',
      },
    },
  }), { status: 400, headers: { 'content-type': 'application/json' } });

  try {
    await assert.rejects(
      () => createFalabellaForwardManifest(['10']),
      /E034: All order items must be ready to ship/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUserId === undefined) delete process.env.FALABELLA_USER_ID;
    else process.env.FALABELLA_USER_ID = originalUserId;
    if (originalApiKey === undefined) delete process.env.FALABELLA_API_KEY;
    else process.env.FALABELLA_API_KEY = originalApiKey;
  }
});

test('reintenta el manifiesto después de un 400 transitorio de ready_to_ship', async () => {
  const originalFetch = globalThis.fetch;
  const originalUserId = process.env.FALABELLA_USER_ID;
  const originalApiKey = process.env.FALABELLA_API_KEY;
  const actions: string[] = [];
  let createAttempts = 0;
  const sample = await PDFDocument.create();
  sample.addPage([612, 792]);
  const encodedPdf = Buffer.from(await sample.save()).toString('base64');

  process.env.FALABELLA_USER_ID = 'seller@example.com';
  process.env.FALABELLA_API_KEY = 'test-api-key';
  globalThis.fetch = async (input) => {
    const action = new URL(String(input)).searchParams.get('Action') ?? '';
    actions.push(action);
    if (action === 'GetManifestList') {
      return new Response(JSON.stringify({
        SuccessResponse: { Body: { Manifests: {} } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (action === 'CreateForwardManifest') {
      createAttempts += 1;
      if (createAttempts === 1) {
        return new Response(JSON.stringify({
          ErrorResponse: {
            Head: { ErrorCode: 'E034', ErrorMessage: 'Order item is not ready to ship yet' },
          },
        }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        SuccessResponse: { Body: { ManifestId: 'MF-RETRY' } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      SuccessResponse: {
        Body: { MimeType: 'application/pdf', File: encodedPdf },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const documents = await createFalabellaForwardManifestPdfs(['10']);
    assert.equal(documents.length, 1);
    assert.equal(createAttempts, 2);
    assert.deepEqual(actions, [
      'GetManifestList',
      'CreateForwardManifest',
      'GetManifestList',
      'CreateForwardManifest',
      'GetManifestDocument',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUserId === undefined) delete process.env.FALABELLA_USER_ID;
    else process.env.FALABELLA_USER_ID = originalUserId;
    if (originalApiKey === undefined) delete process.env.FALABELLA_API_KEY;
    else process.env.FALABELLA_API_KEY = originalApiKey;
  }
});

test('reutiliza el manifiesto remoto y crea otro solo para ítems todavía no manifestados', async () => {
  const originalFetch = globalThis.fetch;
  const originalUserId = process.env.FALABELLA_USER_ID;
  const originalApiKey = process.env.FALABELLA_API_KEY;
  const actions: string[] = [];
  let createBody: BodyInit | null | undefined;
  const sample = await PDFDocument.create();
  sample.addPage([612, 792]);
  const encodedPdf = Buffer.from(await sample.save()).toString('base64');

  process.env.FALABELLA_USER_ID = 'seller@example.com';
  process.env.FALABELLA_API_KEY = 'test-api-key';
  globalThis.fetch = async (input, options) => {
    const action = new URL(String(input)).searchParams.get('Action') ?? '';
    actions.push(action);
    if (action === 'GetManifestList') {
      return new Response(JSON.stringify({
        SuccessResponse: {
          Body: {
            Manifests: {
              Manifest: [{
                ManifestId: 'MF-EXISTING',
                OrderItems: { OrderItem: [{ OrderItemId: '10' }] },
              }],
            },
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (action === 'CreateForwardManifest') {
      createBody = options?.body;
      return new Response(JSON.stringify({
        SuccessResponse: { Body: { ManifestId: 'MF-NEW' } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      SuccessResponse: {
        Body: { MimeType: 'application/pdf', File: encodedPdf },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const documents = await createFalabellaForwardManifestPdfs(['10', '11']);

    assert.equal(documents.length, 2);
    assert.deepEqual(actions, [
      'GetManifestList',
      'CreateForwardManifest',
      'GetManifestDocument',
      'GetManifestDocument',
    ]);
    assert.equal(
      createBody,
      '<Request><OrderItemIds>11</OrderItemIds></Request>',
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUserId === undefined) delete process.env.FALABELLA_USER_ID;
    else process.env.FALABELLA_USER_ID = originalUserId;
    if (originalApiKey === undefined) delete process.env.FALABELLA_API_KEY;
    else process.env.FALABELLA_API_KEY = originalApiKey;
  }
});
