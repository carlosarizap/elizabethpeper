import { PDFDocument } from 'pdf-lib';

const LETTER_WIDTH = 612;
const LETTER_HEIGHT = 792;
const GRID_MARGIN = 18;
const GRID_GAP = 12;
const GRID_COLUMNS = 2;
const GRID_ROWS = 2;

// Falabella entrega la etiqueta en la esquina superior izquierda de una hoja A4.
// Estas proporciones conservan todo el contenido visible y eliminan el resto vacío.
const FALABELLA_A4_CROP_WIDTH_RATIO = 300 / 595.92;
const FALABELLA_A4_CROP_HEIGHT_RATIO = 442 / 841.92;

function getUsefulCrop(pageWidth: number, pageHeight: number) {
  const hasA4Envelope = pageWidth >= 560 && pageHeight >= 780 && pageHeight > pageWidth;
  if (!hasA4Envelope) {
    return {
      left: 0,
      bottom: 0,
      right: pageWidth,
      top: pageHeight,
    };
  }

  const cropWidth = pageWidth * FALABELLA_A4_CROP_WIDTH_RATIO;
  const cropHeight = pageHeight * FALABELLA_A4_CROP_HEIGHT_RATIO;
  return {
    left: 0,
    bottom: pageHeight - cropHeight,
    right: cropWidth,
    top: pageHeight,
  };
}

export async function composeFalabellaLabelsLetterGridPdf(
  sourceDocuments: readonly Uint8Array[],
): Promise<Uint8Array> {
  if (sourceDocuments.length === 0) {
    throw new Error('No hay etiquetas Falabella para componer.');
  }

  const output = await PDFDocument.create();
  const cellWidth = (
    LETTER_WIDTH - GRID_MARGIN * 2 - GRID_GAP * (GRID_COLUMNS - 1)
  ) / GRID_COLUMNS;
  const cellHeight = (
    LETTER_HEIGHT - GRID_MARGIN * 2 - GRID_GAP * (GRID_ROWS - 1)
  ) / GRID_ROWS;
  let labelIndex = 0;

  for (const sourceBytes of sourceDocuments) {
    const source = await PDFDocument.load(sourceBytes);
    for (const sourcePage of source.getPages()) {
      const slot = labelIndex % (GRID_COLUMNS * GRID_ROWS);
      const targetPage = slot === 0
        ? output.addPage([LETTER_WIDTH, LETTER_HEIGHT])
        : output.getPage(output.getPageCount() - 1);
      const column = slot % GRID_COLUMNS;
      const rowFromTop = Math.floor(slot / GRID_COLUMNS);
      const { width: pageWidth, height: pageHeight } = sourcePage.getSize();
      const crop = getUsefulCrop(pageWidth, pageHeight);
      const cropWidth = crop.right - crop.left;
      const cropHeight = crop.top - crop.bottom;
      const scale = Math.min(cellWidth / cropWidth, cellHeight / cropHeight);
      const drawWidth = cropWidth * scale;
      const drawHeight = cropHeight * scale;
      const embeddedPage = await output.embedPage(sourcePage, crop);
      const x = GRID_MARGIN
        + column * (cellWidth + GRID_GAP)
        + (cellWidth - drawWidth) / 2;
      const y = LETTER_HEIGHT
        - GRID_MARGIN
        - (rowFromTop + 1) * cellHeight
        - rowFromTop * GRID_GAP
        + (cellHeight - drawHeight) / 2;

      targetPage.drawPage(embeddedPage, {
        x,
        y,
        width: drawWidth,
        height: drawHeight,
      });
      labelIndex += 1;
    }
  }

  return output.save();
}
