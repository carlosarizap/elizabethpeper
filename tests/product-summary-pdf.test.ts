import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { wrapPdfText } from '../src/app/lib/dispatches/product-summary-pdf.ts';

test('el resumen PDF conserva nombres y cantidades al dividir líneas', async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const lines = wrapPdfText(
    '2 - Juego de Sábanas 1 Plaza\n1 - Funda de Cojín Decorativa',
    font,
    7,
    150,
    5,
  );
  const text = lines.join(' ');

  assert.match(text, /Juego de Sábanas/);
  assert.match(text, /2 - Juego/);
  assert.match(text, /Funda de Cojín/);
  assert.match(text, /1 - Funda/);
  assert.ok(lines.some((line) => line.startsWith('1 - Funda')));
});
