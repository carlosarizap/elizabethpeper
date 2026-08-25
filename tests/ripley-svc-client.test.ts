import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRipleySvcBasicAuthorization,
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
