import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateFalabellaSignature } from '../src/app/lib/falabella/signature-helper.ts';
import { markFalabellaOrderReadyToShip } from '../src/app/lib/falabella/seller-center-client.ts';

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
