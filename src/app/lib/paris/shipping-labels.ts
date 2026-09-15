import { PDFDocument, StandardFonts } from 'pdf-lib';
import { drawProductSummaryBlock } from '../dispatches/product-summary-pdf.ts';
import { composeLetterLabelPdf } from '../mercadolibre/shipping-label-utils.ts';

const PARIS_API = 'https://api-developers.ecomm.cencosud.com';
const PARIS_TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);
const PARIS_RETRY_DELAYS_MS = [500, 1_500, 3_000, 5_000, 8_000];

const LETTER_WIDTH = 612;
const LETTER_HEIGHT = 792;
const GRID_MARGIN = 18;
const GRID_GAP = 12;
const GRID_COLUMNS = 2;
const GRID_ROWS = 2;
const SUMMARY_HEIGHT = 78;
const SUMMARY_GAP = 4;
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

export interface ParisLabelPrintInput {
  document: Uint8Array;
  orderId: string;
  productSummary: string | null;
}

type ParisLabelSource = Uint8Array | ParisLabelPrintInput;

function cleanString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  return cleaned || null;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function retryAfterMs(response: Response, fallbackMs: number): number {
  const value = response.headers.get('retry-after');
  if (value === null) return fallbackMs + Math.floor(Math.random() * 250);
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1_000, 15_000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.min(date - Date.now(), 15_000)) : fallbackMs;
}

async function wait(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * La pasarela de Cencosud puede responder temporalmente sin un servidor sano
 * detrás del balanceador. Estos GET son seguros de repetir y se espacian para
 * que una caída breve no obligue al usuario a reconstruir el lote manualmente.
 */
async function fetchParisWithRetry(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= PARIS_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (!PARIS_TRANSIENT_STATUSES.has(response.status) || attempt === PARIS_RETRY_DELAYS_MS.length) {
        return response;
      }
      await response.arrayBuffer().catch(() => null);
      await wait(retryAfterMs(response, PARIS_RETRY_DELAYS_MS[attempt]));
    } catch (error) {
      lastError = error;
      if (attempt === PARIS_RETRY_DELAYS_MS.length) throw error;
      await wait(PARIS_RETRY_DELAYS_MS[attempt] + Math.floor(Math.random() * 250));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('París no respondió.');
}

async function parisApiRequest(path: string, accessToken: string): Promise<unknown> {
  const response = await fetchParisWithRetry(`${PARIS_API}${path}`, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const rawBody = await response.text();
  let payload: Record<string, unknown> | null = null;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    // El gateway a veces devuelve texto plano en errores transitorios.
  }
  if (!response.ok) {
    const message = cleanString(payload?.message)
      ?? cleanString(payload?.error)
      ?? cleanString(rawBody)?.slice(0, 220);
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
  const response = await fetchParisWithRetry(parsed, { cache: 'no-store' });
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
  const urlGroups: string[][] = [];
  for (const labelId of labelIds) {
    urlGroups.push(await requestLabelUrls(labelId, multitracking, accessToken));
  }
  const urls = [...new Set(urlGroups.flat())];
  return Promise.all(urls.map(downloadPdf));
}

export async function composeParisLabelsLetterGridPdf(
  sourceDocuments: readonly ParisLabelSource[],
): Promise<Uint8Array> {
  if (sourceDocuments.length === 0) {
    throw new Error('No hay etiquetas París para componer.');
  }

  const output = await PDFDocument.create();
  const regularFont = await output.embedFont(StandardFonts.Helvetica);
  const boldFont = await output.embedFont(StandardFonts.HelveticaBold);
  const cropWidth = PARIS_CROP.right - PARIS_CROP.left;
  const cropHeight = PARIS_CROP.top - PARIS_CROP.bottom;
  const cellWidth = (
    LETTER_WIDTH - GRID_MARGIN * 2 - GRID_GAP * (GRID_COLUMNS - 1)
  ) / GRID_COLUMNS;
  const cellHeight = (
    LETTER_HEIGHT - GRID_MARGIN * 2 - GRID_GAP * (GRID_ROWS - 1)
  ) / GRID_ROWS;

  let labelIndex = 0;
  for (const sourceDocument of sourceDocuments) {
    const source = sourceDocument instanceof Uint8Array
      ? { document: sourceDocument, orderId: 'SIN ORDEN', productSummary: null }
      : sourceDocument;
    // París entrega una página completa con una etiqueta pequeña al centro.
    // Normalizamos cada documento por separado para conservar su resumen asociado.
    const normalizedBytes = await composeLetterLabelPdf([source.document]);
    const normalized = await PDFDocument.load(normalizedBytes);

    for (const normalizedPage of normalized.getPages()) {
      const slot = labelIndex % (GRID_COLUMNS * GRID_ROWS);
      const targetPage = slot === 0
        ? output.addPage([LETTER_WIDTH, LETTER_HEIGHT])
        : output.getPage(output.getPageCount() - 1);
      const column = slot % GRID_COLUMNS;
      const rowFromTop = Math.floor(slot / GRID_COLUMNS);
      const cellX = GRID_MARGIN + column * (cellWidth + GRID_GAP);
      const cellY = LETTER_HEIGHT
        - GRID_MARGIN
        - (rowFromTop + 1) * cellHeight
        - rowFromTop * GRID_GAP;
      const availableLabelHeight = cellHeight - SUMMARY_HEIGHT - SUMMARY_GAP;
      const scale = Math.min(
        cellWidth / cropWidth,
        availableLabelHeight / cropHeight,
      );
      const drawWidth = cropWidth * scale;
      const drawHeight = cropHeight * scale;
      const embeddedPage = await output.embedPage(normalizedPage, PARIS_CROP);

      targetPage.drawPage(embeddedPage, {
        x: cellX + (cellWidth - drawWidth) / 2,
        y: cellY + (availableLabelHeight - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
      });
      drawProductSummaryBlock(targetPage, {
        x: cellX,
        y: cellY + availableLabelHeight + SUMMARY_GAP,
        width: cellWidth,
        height: SUMMARY_HEIGHT,
        orderId: source.orderId,
        productSummary: source.productSummary,
        regularFont,
        boldFont,
        bodyFontSize: 6,
        maxLines: 9,
      });
      labelIndex += 1;
    }
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
