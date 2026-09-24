import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { drawProductSummaryBlock } from '../dispatches/product-summary-pdf.ts';
import {
  parseWalmartNumber,
  toArray,
  type WalmartOrder,
  type WalmartOrderLine,
  type WalmartOrderLineStatus,
} from './order-sync.ts';

const WALMART_API_BASE = 'https://marketplace.walmartapis.com';
const WALMART_GLOBAL_VERSION = '3.1';
const REQUEST_TIMEOUT_MS = 30_000;
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const LABEL_RETRY_DELAYS_MS = [1_500, 3_000, 5_000, 8_000, 12_000, 18_000, 25_000, 30_000];
const LABEL_TRANSIENT_STATUSES = new Set([400, 404, 409, 429, 500, 502, 503, 504]);
const LETTER_WIDTH = 612;
const LETTER_HEIGHT = 792;
const GRID_MARGIN = 18;
const GRID_GAP = 12;
const GRID_COLUMNS = 2;
const GRID_ROWS = 2;
const SUMMARY_HEIGHT = 58;
const SUMMARY_GAP = 4;
const WALMART_CROP = {
  left: 30,
  // El PDF Walmart es A4 y agrega metadatos técnicos bajo el logo. El corte
  // conserva etiqueta + logo, pero excluye nro_de_linea/service/etc.
  bottom: 550,
  right: 300,
  top: 815,
};

interface WalmartCredentials {
  clientId: string;
  clientSecret: string;
}

interface WalmartTokenResponse {
  access_token?: string;
  expires_in?: number | string;
}

interface WalmartOrderResponse {
  order?: WalmartOrder;
}

export interface WalmartLabelEligibility {
  eligible: boolean;
  shouldAcknowledge: boolean;
  reason: string | null;
}

export interface WalmartLabelPrintInput {
  document: Uint8Array;
  orderId: string;
  productSummary: string | null;
}

export interface WalmartPreparedLabelDocument {
  document: Uint8Array;
  productSummary: string;
}

export interface WalmartLabelGroup {
  trackingNumbers: string[];
  productSummary: string;
}

let tokenCache: { token: string; expiresAt: number } | null = null;

function credentials(): WalmartCredentials {
  const clientId = process.env.WALMART_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.WALMART_CLIENT_SECRET ?? '';
  if (!clientId || !clientSecret) {
    throw new Error('Faltan las credenciales API de Walmart.');
  }
  return { clientId, clientSecret };
}

function basicAuthorization(value: WalmartCredentials): string {
  return `Basic ${Buffer.from(`${value.clientId}:${value.clientSecret}`).toString('base64')}`;
}

function requestHeaders(
  accessToken: string | null,
  accept = 'application/json',
): Record<string, string> {
  const configured = credentials();
  return {
    Authorization: basicAuthorization(configured),
    ...(accessToken ? { 'WM_SEC.ACCESS_TOKEN': accessToken } : {}),
    WM_MARKET: 'cl',
    WM_GLOBAL_VERSION: WALMART_GLOBAL_VERSION,
    'WM_QOS.CORRELATION_ID': randomUUID(),
    'WM_SVC.NAME': 'Walmart Marketplace',
    Accept: accept,
  };
}

async function responsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (/json/i.test(contentType)) return response.json().catch(() => null);
  return response.text().catch(() => '');
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const root = payload as Record<string, unknown>;
    const errors = root.errors as { error?: unknown } | undefined;
    const first = Array.isArray(errors?.error) ? errors.error[0] : errors?.error;
    if (first && typeof first === 'object') {
      const detail = first as Record<string, unknown>;
      for (const key of ['description', 'message', 'code']) {
        if (typeof detail[key] === 'string' && detail[key].trim()) {
          return detail[key].trim().slice(0, 350);
        }
      }
    }
    for (const key of ['message', 'error', 'description']) {
      if (typeof root[key] === 'string' && root[key].trim()) {
        return root[key].trim().slice(0, 350);
      }
    }
  }
  if (typeof payload === 'string' && payload.trim()) return payload.trim().slice(0, 350);
  return `código ${status}`;
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }

  const response = await fetch(`${WALMART_API_BASE}/v3/token`, {
    method: 'POST',
    headers: {
      ...requestHeaders(null),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await responsePayload(response) as WalmartTokenResponse | null;
  const token = typeof payload?.access_token === 'string' ? payload.access_token : '';
  if (!response.ok || !token) {
    throw new Error(
      `Walmart rechazó la autenticación: ${errorMessage(payload, response.status)}.`,
    );
  }

  const expiresIn = Math.max(60, Number(payload?.expires_in ?? 900));
  tokenCache = {
    token,
    expiresAt: Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_MARGIN_MS,
  };
  return token;
}

async function walmartRequest(
  path: string,
  init: RequestInit = {},
  accept = 'application/json',
): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const accessToken = await getAccessToken(attempt === 1);
    const headers = new Headers(init.headers);
    for (const [key, value] of Object.entries(requestHeaders(accessToken, accept))) {
      headers.set(key, value);
    }
    const response = await fetch(`${WALMART_API_BASE}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status !== 401 || attempt === 1) return response;
    tokenCache = null;
  }
  throw new Error('No fue posible autenticar la API de Walmart.');
}

async function readOrderResponse(response: Response, context: string): Promise<WalmartOrder> {
  const payload = await responsePayload(response) as WalmartOrderResponse | null;
  if (!response.ok || !payload?.order?.purchaseOrderId) {
    throw new Error(`Walmart no permitió ${context}: ${errorMessage(payload, response.status)}.`);
  }
  return payload.order;
}

export async function fetchWalmartOrderForLabel(purchaseOrderId: string): Promise<WalmartOrder> {
  const response = await walmartRequest(
    `/v3/orders/${encodeURIComponent(purchaseOrderId)}`,
  );
  return readOrderResponse(response, `consultar la orden ${purchaseOrderId}`);
}

function currentLineStatus(line: WalmartOrderLine): WalmartOrderLineStatus | null {
  return toArray(line.orderLineStatuses?.orderLineStatus).at(-1) ?? null;
}

export function getWalmartCurrentStatuses(order: WalmartOrder): string[] {
  return toArray(order.orderLines?.orderLine)
    .map((line) => String(currentLineStatus(line)?.status ?? '').trim())
    .filter(Boolean);
}

export function getWalmartTrackingNumbers(order: WalmartOrder): string[] {
  return [...new Set(
    toArray(order.orderLines?.orderLine)
      .flatMap((line) => toArray(line.orderLineStatuses?.orderLineStatus))
      .map((status) => String(status.trackingInfo?.trackingNumber ?? '').trim())
      .filter(Boolean),
  )];
}

export function getWalmartLabelGroups(order: WalmartOrder): WalmartLabelGroup[] {
  const grouped = new Map<string, Set<string>>();
  for (const line of toArray(order.orderLines?.orderLine)) {
    const title = String(line.item?.productName ?? line.item?.sku ?? 'Producto Walmart').trim()
      || 'Producto Walmart';
    const trackingNumbers = toArray(line.orderLineStatuses?.orderLineStatus)
      .map((status) => String(status.trackingInfo?.trackingNumber ?? '').trim())
      .filter(Boolean);
    if (trackingNumbers.length === 0) continue;
    const group = grouped.get(title) ?? new Set<string>();
    for (const trackingNumber of trackingNumbers) group.add(trackingNumber);
    grouped.set(title, group);
  }
  return [...grouped.entries()].map(([title, trackingNumbers]) => ({
    trackingNumbers: [...trackingNumbers],
    // Walmart emite una etiqueta por unidad, aunque varias unidades compartan producto.
    productSummary: `1 - ${title}`,
  }));
}

export function getWalmartLabelEligibility(order: WalmartOrder): WalmartLabelEligibility {
  const statuses = getWalmartCurrentStatuses(order).map((status) => status.toUpperCase());
  if (statuses.length === 0) {
    return {
      eligible: false,
      shouldAcknowledge: false,
      reason: 'Walmart no informó el estado actual de la orden.',
    };
  }

  const unsupported = statuses.find(
    (status) => status !== 'CREATED' && status !== 'ACKNOWLEDGED',
  );
  if (unsupported) {
    return {
      eligible: false,
      shouldAcknowledge: false,
      reason: `La orden está en estado ${unsupported} y ya no requiere una etiqueta nueva.`,
    };
  }
  return {
    eligible: true,
    shouldAcknowledge: statuses.includes('CREATED'),
    reason: null,
  };
}

function acknowledgementBody(order: WalmartOrder) {
  return {
    orderAcknowledgement: {
      orderLines: {
        orderLine: toArray(order.orderLines?.orderLine).map((line) => ({
          lineNumber: String(line.lineNumber ?? ''),
          orderLineStatuses: {
            orderLineStatus: [{
              status: 'Acknowledged',
              statusQuantity: {
                unitOfMeasurement: line.orderLineQuantity?.unitOfMeasurement || 'EACH',
                amount: String(Math.max(1, parseWalmartNumber(line.orderLineQuantity?.amount))),
              },
            }],
          },
        })),
      },
    },
  };
}

export function getWalmartAcknowledgePath(purchaseOrderId: string): string {
  return `/v3/orders/${encodeURIComponent(purchaseOrderId)}/acknowledgeLines`;
}

export async function acknowledgeWalmartOrder(order: WalmartOrder): Promise<WalmartOrder> {
  const purchaseOrderId = String(order.purchaseOrderId ?? '').trim();
  if (!purchaseOrderId) throw new Error('La orden Walmart no tiene un identificador válido.');
  const response = await walmartRequest(
    getWalmartAcknowledgePath(purchaseOrderId),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(acknowledgementBody(order)),
    },
  );
  return readOrderResponse(response, `aprobar la orden ${purchaseOrderId}`);
}

function isPdf(document: Uint8Array): boolean {
  return document.length >= 5
    && Buffer.from(document.subarray(0, 5)).toString('ascii') === '%PDF-';
}

async function downloadWalmartLabels(trackingNumbers: readonly string[]): Promise<Uint8Array> {
  let lastError = 'La etiqueta todavía se está generando.';
  for (let attempt = 0; attempt <= LABEL_RETRY_DELAYS_MS.length; attempt += 1) {
    const response = await walmartRequest(
      '/v3/orders/labels',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          FORMAT: 'PDF',
        },
        body: JSON.stringify({ trackingNumbers: [...new Set(trackingNumbers)] }),
      },
      'application/octet-stream',
    );
    const document = new Uint8Array(await response.arrayBuffer());
    if (response.ok && isPdf(document)) return document;

    let detail: unknown = '';
    try {
      detail = JSON.parse(Buffer.from(document).toString('utf8'));
    } catch {
      detail = Buffer.from(document).toString('utf8');
    }
    lastError = errorMessage(detail, response.status);
    const retryable = LABEL_TRANSIENT_STATUSES.has(response.status)
      || (response.ok && !isPdf(document));
    if (!retryable || attempt === LABEL_RETRY_DELAYS_MS.length) break;
    await wait(labelRetryDelay(response, LABEL_RETRY_DELAYS_MS[attempt]));
  }
  throw new Error(`Walmart no entregó el PDF de etiquetas: ${lastError}.`);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function labelRetryDelay(response: Response, fallback: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter === null) return fallback;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1_000, 30_000));
  const date = Date.parse(retryAfter);
  return Number.isFinite(date)
    ? Math.max(0, Math.min(date - Date.now(), 30_000))
    : fallback;
}

async function waitForTrackingNumbers(order: WalmartOrder): Promise<{
  order: WalmartOrder;
  trackingNumbers: string[];
}> {
  let current = order;
  for (let attempt = 0; attempt <= LABEL_RETRY_DELAYS_MS.length; attempt += 1) {
    const trackingNumbers = getWalmartTrackingNumbers(current);
    if (trackingNumbers.length > 0) return { order: current, trackingNumbers };
    if (attempt < LABEL_RETRY_DELAYS_MS.length) {
      await wait(LABEL_RETRY_DELAYS_MS[attempt]);
      current = await fetchWalmartOrderForLabel(String(current.purchaseOrderId));
    }
  }
  return { order: current, trackingNumbers: [] };
}

export async function prepareWalmartShippingLabelPdfs(
  purchaseOrderId: string,
): Promise<{ documents: WalmartPreparedLabelDocument[]; acknowledged: boolean }> {
  let order = await fetchWalmartOrderForLabel(purchaseOrderId);
  const eligibility = getWalmartLabelEligibility(order);
  if (!eligibility.eligible) {
    throw new Error(eligibility.reason ?? 'La orden Walmart no está disponible para imprimir.');
  }

  let acknowledged = false;
  if (eligibility.shouldAcknowledge) {
    order = await acknowledgeWalmartOrder(order);
    acknowledged = true;
  }

  const prepared = await waitForTrackingNumbers(order);
  if (prepared.trackingNumbers.length === 0) {
    throw new Error(
      'Walmart aprobó la orden, pero todavía no generó el número de seguimiento de la etiqueta. Intenta nuevamente en unos segundos.',
    );
  }

  const groups = getWalmartLabelGroups(prepared.order);
  const assignedTrackingNumbers = new Set(groups.flatMap((group) => group.trackingNumbers));
  const unassignedTrackingNumbers = prepared.trackingNumbers.filter(
    (trackingNumber) => !assignedTrackingNumbers.has(trackingNumber),
  );
  if (unassignedTrackingNumbers.length > 0) {
    groups.push({
      trackingNumbers: unassignedTrackingNumbers,
      productSummary: '1 - Producto Walmart',
    });
  }

  const documents: WalmartPreparedLabelDocument[] = [];
  for (const group of groups) {
    documents.push({
      document: await downloadWalmartLabels(group.trackingNumbers),
      productSummary: group.productSummary,
    });
  }
  return { documents, acknowledged };
}

export async function composeWalmartLabelsWithProductSummaryPdf(
  inputs: readonly WalmartLabelPrintInput[],
): Promise<Uint8Array> {
  if (inputs.length === 0) {
    throw new Error('No hay etiquetas Walmart para componer.');
  }

  const output = await PDFDocument.create();
  const regularFont = await output.embedFont(StandardFonts.Helvetica);
  const boldFont = await output.embedFont(StandardFonts.HelveticaBold);
  const cropWidth = WALMART_CROP.right - WALMART_CROP.left;
  const cropHeight = WALMART_CROP.top - WALMART_CROP.bottom;
  const cellWidth = (
    LETTER_WIDTH - GRID_MARGIN * 2 - GRID_GAP * (GRID_COLUMNS - 1)
  ) / GRID_COLUMNS;
  const cellHeight = (
    LETTER_HEIGHT - GRID_MARGIN * 2 - GRID_GAP * (GRID_ROWS - 1)
  ) / GRID_ROWS;

  let labelIndex = 0;
  for (const input of inputs) {
    const source = await PDFDocument.load(input.document);
    for (const sourcePage of source.getPages()) {
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
      const scale = Math.min(cellWidth / cropWidth, availableLabelHeight / cropHeight);
      const drawWidth = cropWidth * scale;
      const drawHeight = cropHeight * scale;
      const embeddedPage = await output.embedPage(sourcePage, WALMART_CROP);

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
        orderId: input.orderId,
        productSummary: input.productSummary,
        regularFont,
        boldFont,
        bodyFontSize: 6.5,
        maxLines: 4,
      });
      labelIndex += 1;
    }
  }

  return output.save();
}

export function walmartLabelError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 500);
  return 'No fue posible preparar la etiqueta de Walmart.';
}
