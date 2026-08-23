import { PDFDocument } from 'pdf-lib';

const LETTER_WIDTH = 612;
const LETTER_HEIGHT = 792;
const LETTER_MARGIN = 12;

export interface LetterLabelDocument {
  bytes: Uint8Array;
  orientation?: 'portrait' | 'landscape';
}

export type LetterLabelSource = Uint8Array | LetterLabelDocument;

export const PRINTABLE_LOGISTIC_TYPES = new Set([
  'drop_off',
  'xd_drop_off',
  'cross_docking',
  'self_service',
]);

export interface MercadoLibreLabelSnapshot {
  status: string | null;
  substatus: string | null;
  mode: string | null;
  logisticType: string | null;
}

export function isMercadoLibreShipmentWaitingForLabel(
  shipment: MercadoLibreLabelSnapshot | null,
): boolean {
  if (!shipment || shipment.mode !== 'me2') return false;
  if (!shipment.logisticType || !PRINTABLE_LOGISTIC_TYPES.has(shipment.logisticType)) {
    return false;
  }
  return (
    (shipment.status === 'pending' && shipment.substatus === 'manufacturing')
    || (shipment.status === 'handling' && shipment.substatus === 'waiting_for_label_generation')
  );
}

export function canMarkMercadoLibreShipmentReady(
  shipment: MercadoLibreLabelSnapshot | null,
): boolean {
  return Boolean(
    shipment
    && shipment.mode === 'me2'
    && shipment.logisticType
    && PRINTABLE_LOGISTIC_TYPES.has(shipment.logisticType)
    && shipment.status === 'pending'
    && shipment.substatus === 'manufacturing',
  );
}

export function getMercadoLibreLabelEligibility(
  shipment: MercadoLibreLabelSnapshot | null,
): { eligible: boolean; reason: string | null } {
  if (!shipment) {
    return { eligible: false, reason: 'El envío todavía no está sincronizado.' };
  }
  if (shipment.mode !== 'me2') {
    return { eligible: false, reason: 'El envío no utiliza Mercado Envíos 2.' };
  }
  if (!shipment.logisticType || !PRINTABLE_LOGISTIC_TYPES.has(shipment.logisticType)) {
    return { eligible: false, reason: 'La modalidad logística no permite imprimir esta etiqueta.' };
  }
  if (shipment.status !== 'ready_to_ship') {
    return { eligible: false, reason: 'Mercado Libre todavía no habilita la etiqueta.' };
  }
  if (!shipment.substatus || !['ready_to_print', 'printed'].includes(shipment.substatus)) {
    return { eligible: false, reason: 'La etiqueta aún no está lista para imprimir.' };
  }
  return { eligible: true, reason: null };
}

export async function composeLetterLabelPdf(
  sourceDocuments: readonly LetterLabelSource[],
): Promise<Uint8Array> {
  if (sourceDocuments.length === 0) {
    throw new Error('No hay documentos para componer.');
  }

  const output = await PDFDocument.create();

  for (const sourceDocument of sourceDocuments) {
    const sourceBytes = sourceDocument instanceof Uint8Array
      ? sourceDocument
      : sourceDocument.bytes;
    const orientation = sourceDocument instanceof Uint8Array
      ? 'portrait'
      : sourceDocument.orientation ?? 'portrait';
    const source = await PDFDocument.load(sourceBytes);
    for (let pageIndex = 0; pageIndex < source.getPageCount(); pageIndex += 1) {
      const sourcePage = source.getPage(pageIndex);
      const { width, height } = sourcePage.getSize();
      const [embeddedPage] = await output.embedPdf(sourceBytes, [pageIndex]);
      const targetWidth = orientation === 'landscape' ? LETTER_HEIGHT : LETTER_WIDTH;
      const targetHeight = orientation === 'landscape' ? LETTER_WIDTH : LETTER_HEIGHT;
      const maxWidth = targetWidth - LETTER_MARGIN * 2;
      const maxHeight = targetHeight - LETTER_MARGIN * 2;
      const scale = Math.min(1, maxWidth / width, maxHeight / height);
      const drawWidth = width * scale;
      const drawHeight = height * scale;
      const page = output.addPage([targetWidth, targetHeight]);

      page.drawPage(embeddedPage, {
        x: (targetWidth - drawWidth) / 2,
        y: (targetHeight - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
      });
    }
  }

  return output.save();
}
