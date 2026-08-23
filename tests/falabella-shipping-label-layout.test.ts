import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, rgb } from 'pdf-lib';
import { composeFalabellaLabelsLetterGridPdf } from '../src/app/lib/falabella/shipping-label-layout.ts';

async function createFalabellaA4Label(): Promise<Uint8Array> {
  const source = await PDFDocument.create();
  const page = source.addPage([595.92, 841.92]);
  page.drawRectangle({
    x: 6,
    y: 410,
    width: 284,
    height: 420,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  });
  return source.save();
}

test('Falabella recorta el A4 y compone cuatro etiquetas en una hoja carta', async () => {
  const label = await createFalabellaA4Label();
  const result = await composeFalabellaLabelsLetterGridPdf([label, label, label, label]);
  const output = await PDFDocument.load(result);

  assert.equal(output.getPageCount(), 1);
  assert.deepEqual(output.getPage(0).getSize(), { width: 612, height: 792 });
});

test('Falabella continúa en otra hoja después de cuatro etiquetas', async () => {
  const label = await createFalabellaA4Label();
  const result = await composeFalabellaLabelsLetterGridPdf([
    label,
    label,
    label,
    label,
    label,
  ]);
  const output = await PDFDocument.load(result);

  assert.equal(output.getPageCount(), 2);
});
