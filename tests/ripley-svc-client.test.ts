import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRipleyOrderListQuery,
  createRipleySvcBasicAuthorization,
  getRipleySvcConnectionStatus,
  parseRipleyLabelDownloadResponse,
  RipleySvcError,
  ripleySvcError,
} from '../src/app/lib/ripley/svc-client.ts';

const PDF_BASE64 = Buffer.from('%PDF-1.4\n% test label').toString('base64');

test('builds the SVC Basic credential from seller username and password', () => {
  const authorization = createRipleySvcBasicAuthorization('seller_elipeper', 'secret');
  assert.equal(
    Buffer.from(authorization.replace(/^Basic /, ''), 'base64').toString('utf8'),
    'seller_elipeper:secret',
  );
});

test('normalizes quotes and surrounding whitespace from the SVC API key', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.RIPLEY_SVC_API_KEY;
  const originalPassword = process.env.RIPLEY_SVC_PASSWORD;
  let receivedCredential = '';

  process.env.RIPLEY_SVC_API_KEY = '  "seller_elipeper:secret"  \n';
  delete process.env.RIPLEY_SVC_PASSWORD;
  globalThis.fetch = async (_input, options) => {
    const authorization = new Headers(options?.headers).get('authorization') ?? '';
    receivedCredential = Buffer.from(authorization.replace(/^Basic /, ''), 'base64').toString('utf8');
    return new Response(JSON.stringify({ access_token: 'test-token' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const status = await getRipleySvcConnectionStatus();
    assert.equal(status.connected, true);
    assert.equal(receivedCredential, 'seller_elipeper:secret');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.RIPLEY_SVC_API_KEY;
    else process.env.RIPLEY_SVC_API_KEY = originalApiKey;
    if (originalPassword === undefined) delete process.env.RIPLEY_SVC_PASSWORD;
    else process.env.RIPLEY_SVC_PASSWORD = originalPassword;
  }
});

test('keeps the response detail when Ripley rejects authentication', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.RIPLEY_SVC_API_KEY;

  process.env.RIPLEY_SVC_API_KEY = 'seller_elipeper:different-secret';
  globalThis.fetch = async () => new Response(JSON.stringify({
    message: 'Invalid authentication credentials',
  }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });

  try {
    const status = await getRipleySvcConnectionStatus();
    assert.equal(status.connected, false);
    assert.match(status.message ?? '', /403: Invalid authentication credentials/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.RIPLEY_SVC_API_KEY;
    else process.env.RIPLEY_SVC_API_KEY = originalApiKey;
  }
});

test('uses the page pagination accepted by the Ripley order list', () => {
  const query = new URLSearchParams(createRipleyOrderListQuery(3));

  assert.equal(query.get('limit'), '25');
  assert.equal(query.get('page'), '3');
  assert.equal(query.has('offset'), false);
  assert.equal(query.has('status_management'), false);
});

test('parses a successful Ripley SVC label response', () => {
  const result = parseRipleyLabelDownloadResponse(
    { labels_generated: PDF_BASE64, orders_without_labels: [] },
    ['100-A', '101-A'],
  );

  assert.equal(Buffer.from(result.document ?? []).subarray(0, 5).toString('ascii'), '%PDF-');
  assert.deepEqual(result.completedOrderIds, ['100-A', '101-A']);
  assert.deepEqual(result.failures, []);
});

test('keeps per-order failures while accepting the generated PDF', () => {
  const result = parseRipleyLabelDownloadResponse(
    {
      labels_generated: `data:application/pdf;base64,${PDF_BASE64}`,
      orders_without_labels: [{ order_id: '101-A', status: 'Etiqueta todavía no disponible' }],
    },
    ['100-A', '101-A'],
  );

  assert.deepEqual(result.completedOrderIds, ['100-A']);
  assert.deepEqual(result.failures, [{
    orderId: '101-A',
    message: 'Etiqueta todavía no disponible',
  }]);
});

test('includes the orders_with_error failures returned by Ripley', () => {
  const result = parseRipleyLabelDownloadResponse(
    {
      labels_generated: PDF_BASE64,
      orders_without_labels: [],
      orders_with_error: [{ order_id: '101-A', message: 'Orden no preparable' }],
    },
    ['100-A', '101-A'],
  );

  assert.deepEqual(result.completedOrderIds, ['100-A']);
  assert.deepEqual(result.failures, [{
    orderId: '101-A',
    message: 'Orden no preparable',
  }]);
});

test('reports every requested order when Ripley returns no PDF or failure detail', () => {
  const result = parseRipleyLabelDownloadResponse(
    { labels_generated: '', orders_without_labels: [] },
    ['100-A', '101-A'],
  );

  assert.equal(result.document, null);
  assert.deepEqual(result.completedOrderIds, []);
  assert.equal(result.failures.length, 2);
});

test('rejects a generated document that is not a PDF', () => {
  assert.throws(
    () => parseRipleyLabelDownloadResponse(
      { labels_generated: Buffer.from('not a pdf').toString('base64') },
      ['100-A'],
    ),
    /no es un PDF válido/,
  );
});

test('keeps the actionable message from Ripley SVC errors', () => {
  assert.equal(
    ripleySvcError(new RipleySvcError('Credenciales API inválidas.', 403)),
    'Credenciales API inválidas.',
  );
});
