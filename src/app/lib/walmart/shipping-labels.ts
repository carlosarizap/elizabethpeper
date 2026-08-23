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
const LABEL_POLL_ATTEMPTS = 4;
const LABEL_POLL_DELAY_MS = 750;
const LETTER_WIDTH = 612;
const LETTER_HEIGHT = 792;
const LETTER_MARGIN = 12;
const SUMMARY_HEIGHT = 92;
const SUMMARY_GAP = 6;

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

export async function acknowledgeWalmartOrder(order: WalmartOrder): Promise<WalmartOrder> {
  const purchaseOrderId = String(order.purchaseOrderId ?? '').trim();
  if (!purchaseOrderId) throw new Error('La orden Walmart no tiene un identificador válido.');
  const response = await walmartRequest(
    `/v3/orders/${encodeURIComponent(purchaseOrderId)}/acknowledge`,
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

async function downloadWalmartLabel(trackingNumber: string): Promise<Uint8Array> {
  const response = await walmartRequest(
    `/v3/orders/label/${encodeURIComponent(trackingNumber)}`,
    {},
    'application/octet-stream',
  );
  const document = new Uint8Array(await response.arrayBuffer());
  if (!response.ok || !isPdf(document)) {
    let detail: unknown = '';
    try {
      detail = JSON.parse(Buffer.from(document).toString('utf8'));
    } catch {
      detail = Buffer.from(document).toString('utf8');
    }
    throw new Error(
      `Walmart no entregó una etiqueta PDF: ${errorMessage(detail, response.status)}.`,
    );
  }
  return document;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForTrackingNumbers(order: WalmartOrder): Promise<{
  order: WalmartOrder;
  trackingNumbers: string[];
}> {
  let current = order;
  for (let attempt = 0; attempt < LABEL_POLL_ATTEMPTS; attempt += 1) {
    const trackingNumbers = getWalmartTrackingNumbers(current);
    if (trackingNumbers.length > 0) return { order: current, trackingNumbers };
    if (attempt < LABEL_POLL_ATTEMPTS - 1) {
      await wait(LABEL_POLL_DELAY_MS);
      current = await fetchWalmartOrderForLabel(String(current.purchaseOrderId));
    }
  }
  return { order: current, trackingNumbers: [] };
}

export async function prepareWalmartShippingLabelPdfs(
  purchaseOrderId: string,
): Promise<{ documents: Uint8Array[]; acknowledged: boolean }> {
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

  const documents: Uint8Array[] = [];
  for (const trackingNumber of prepared.trackingNumbers) {
    documents.push(await downloadWalmartLabel(trackingNumber));
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
  const summaryY = LETTER_HEIGHT - LETTER_MARGIN - SUMMARY_HEIGHT;
  const availableWidth = LETTER_WIDTH - LETTER_MARGIN * 2;
  const availableHeight = summaryY - SUMMARY_GAP - LETTER_MARGIN;

  for (const input of inputs) {
    const source = await PDFDocument.load(input.document);
    for (const sourcePage of source.getPages()) {
      const page = output.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
      const { width, height } = sourcePage.getSize();
      const scale = Math.min(1, availableWidth / width, availableHeight / height);
      const drawWidth = width * scale;
      const drawHeight = height * scale;
      const embeddedPage = await output.embedPage(sourcePage);

      page.drawPage(embeddedPage, {
        x: LETTER_MARGIN + (availableWidth - drawWidth) / 2,
        y: LETTER_MARGIN + (availableHeight - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
      });
      drawProductSummaryBlock(page, {
        x: LETTER_MARGIN,
        y: summaryY,
        width: availableWidth,
        height: SUMMARY_HEIGHT,
        orderId: input.orderId,
        productSummary: input.productSummary,
        regularFont,
        boldFont,
        bodyFontSize: 8,
        maxLines: 8,
      });
    }
  }

  return output.save();
}

export function walmartLabelError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 500);
  return 'No fue posible preparar la etiqueta de Walmart.';
}
