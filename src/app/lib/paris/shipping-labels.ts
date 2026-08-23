import { PDFDocument } from 'pdf-lib';
import { composeLetterLabelPdf } from '../mercadolibre/shipping-label-utils.ts';

const PARIS_API = 'https://api-developers.ecomm.cencosud.com';

const LETTER_WIDTH = 612;
const LETTER_HEIGHT = 792;
const GRID_MARGIN = 18;
const GRID_GAP = 12;
const GRID_COLUMNS = 2;
const GRID_ROWS = 2;
const PARIS_CROP = {
  left: 165,
  bottom: 300,
  right: 447,
  top: 610,
};

interface ParisShipment {
  labelId?: unknown;
  nPackages?: unknown;
}

interface ParisLabelDocument {
  url?: unknown;
  labels?: unknown;
}

function cleanString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  return cleaned || null;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

async function parisApiRequest(path: string, accessToken: string): Promise<unknown> {
  const response = await fetch(`${PARIS_API}${path}`, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = cleanString(payload?.message) ?? cleanString(payload?.error);
    throw new Error(`París respondió ${response.status}${message ? `: ${message}` : ''}`);
  }
  return payload;
}

async function requestLabelUrls(
  labelId: string,
  multitracking: boolean,
  accessToken: string,
): Promise<string[]> {
  const path = multitracking
    ? `/v2/label/print-label/${encodeURIComponent(labelId)}`
    : `/v1/sub-orders/${encodeURIComponent(labelId)}/print-label`;
  const payload = await parisApiRequest(path, accessToken) as {
    data?: ParisLabelDocument | ParisLabelDocument[];
  };
  const urls = new Set<string>();
  for (const document of asArray(payload?.data)) {
    for (const value of [document.labels, document.url]) {
      for (const candidate of asArray(value)) {
        const url = cleanString(candidate);
        if (url) urls.add(url);
      }
    }
  }
  if (urls.size === 0) throw new Error('París no devolvió la URL de la etiqueta.');
  return [...urls];
}

async function downloadPdf(url: string): Promise<Uint8Array> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('París devolvió una URL de etiqueta no segura.');
  const response = await fetch(parsed, { cache: 'no-store' });
  if (!response.ok) throw new Error(`No fue posible descargar la etiqueta París (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 4 || new TextDecoder('ascii').decode(bytes.slice(0, 4)) !== '%PDF') {
    throw new Error('París no devolvió un PDF de etiqueta válido.');
  }
  return bytes;
}

export async function downloadParisShippingLabelPdfs(
  subOrderNumber: string,
  accessToken: string,
): Promise<Uint8Array[]> {
  const payload = await parisApiRequest(
    `/v2/shipments/${encodeURIComponent(subOrderNumber)}`,
    accessToken,
  );
  const shipments = asArray(payload as ParisShipment | ParisShipment[] | null);
  const labelIds = shipments
    .map((shipment) => cleanString(shipment.labelId))
    .filter((labelId): labelId is string => Boolean(labelId));
  if (labelIds.length === 0) throw new Error('París todavía no generó la etiqueta para esta orden.');

  const multitracking = shipments.length > 1
    || shipments.some((shipment) => Number(shipment.nPackages ?? 1) > 1);
  const urlGroups = await Promise.all(
    labelIds.map((labelId) => requestLabelUrls(labelId, multitracking, accessToken)),
  );
  const urls = [...new Set(urlGroups.flat())];
  return Promise.all(urls.map(downloadPdf));
}

export async function composeParisLabelsLetterGridPdf(
  sourceDocuments: readonly Uint8Array[],
): Promise<Uint8Array> {
  if (sourceDocuments.length === 0) {
    throw new Error('No hay etiquetas París para componer.');
  }

  // París entrega una página completa con una etiqueta pequeña al centro.
  // Primero normalizamos cada página a carta y luego recortamos solo el área útil.
  const normalizedBytes = await composeLetterLabelPdf(sourceDocuments);
  const normalized = await PDFDocument.load(normalizedBytes);
  const output = await PDFDocument.create();
  const cropWidth = PARIS_CROP.right - PARIS_CROP.left;
  const cropHeight = PARIS_CROP.top - PARIS_CROP.bottom;
  const cellWidth = (
    LETTER_WIDTH - GRID_MARGIN * 2 - GRID_GAP * (GRID_COLUMNS - 1)
  ) / GRID_COLUMNS;
  const cellHeight = (
    LETTER_HEIGHT - GRID_MARGIN * 2 - GRID_GAP * (GRID_ROWS - 1)
  ) / GRID_ROWS;

  let targetPage = output.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
  for (let pageIndex = 0; pageIndex < normalized.getPageCount(); pageIndex += 1) {
    const slot = pageIndex % (GRID_COLUMNS * GRID_ROWS);
    if (pageIndex > 0 && slot === 0) {
      targetPage = output.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
    }

    const column = slot % GRID_COLUMNS;
    const rowFromTop = Math.floor(slot / GRID_COLUMNS);
    const embeddedPage = await output.embedPage(
      normalized.getPage(pageIndex),
      PARIS_CROP,
    );
    const x = GRID_MARGIN
      + column * (cellWidth + GRID_GAP)
      + (cellWidth - cropWidth) / 2;
    const y = LETTER_HEIGHT
      - GRID_MARGIN
      - (rowFromTop + 1) * cellHeight
      - rowFromTop * GRID_GAP
      + (cellHeight - cropHeight) / 2;

    targetPage.drawPage(embeddedPage, {
      x,
      y,
      width: cropWidth,
      height: cropHeight,
    });
  }

  return output.save();
}

export function parisLabelError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/todav.a no gener.|404/i.test(message)) return 'París todavía no habilita la etiqueta para esta orden.';
  if (/401|403|Unauthorized|Forbidden/i.test(message)) return 'París rechazó la autenticación para descargar la etiqueta.';
  if (/409/i.test(message)) return 'París todavía no permite imprimir esta etiqueta.';
  return message.startsWith('París') || message.startsWith('No fue posible')
    ? message.slice(0, 300)
    : 'No fue posible obtener la etiqueta desde París.';
}
