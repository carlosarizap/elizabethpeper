import { createHash } from 'node:crypto';

const AUTH_PATH = '/api/current/auth/login/vendor';
const FAST_MANAGEMENT_ORDERS_PATH = '/api/v3/orders/order/list';
const LABEL_DOWNLOAD_PATH = '/api/v7/label/label/download/';
const DEFAULT_BASE_URL = 'https://sellercenter.ripleylabs.com';
const DEFAULT_USERNAME = 'seller_elipeper';
const REQUEST_TIMEOUT_MS = 30_000;
const TOKEN_FALLBACK_TTL_MS = 10 * 60_000;
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const ORDER_PAGE_SIZE = 25;

interface RipleySvcConfig {
  baseUrl: string;
  username: string;
  password: string;
  fingerprint: string;
}

interface RipleyAuthResponse {
  status_code?: number;
  access_token?: string;
  message?: string;
}

interface RipleyFastManagementOrder {
  _id?: unknown;
  order_id?: unknown;
  _status_management?: unknown;
}

interface RipleyOrderListResponse {
  total?: unknown;
  orders?: unknown;
  data?: {
    total?: unknown;
    orders?: unknown;
  };
  message?: string;
}

interface RipleyLabelFailurePayload {
  order_id?: unknown;
  status?: unknown;
  message?: unknown;
}

export interface RipleyLabelFailure {
  orderId: string;
  message: string;
}

export interface RipleyLabelDownloadResult {
  document: Uint8Array | null;
  completedOrderIds: string[];
  failures: RipleyLabelFailure[];
}

export interface RipleySvcConnectionStatus {
  configured: boolean;
  connected: boolean;
  message: string | null;
}

export class RipleySvcError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'RipleySvcError';
    this.status = status;
  }
}

let tokenCache: { fingerprint: string; token: string; expiresAt: number } | null = null;

function cleanBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function cleanCredentialValue(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function splitApiKey(value: string): { username: string; password: string } | null {
  const cleaned = cleanCredentialValue(value);
  const separator = cleaned.indexOf(':');
  if (separator <= 0 || separator === cleaned.length - 1) return null;
  return {
    username: cleaned.slice(0, separator).trim(),
    password: cleaned.slice(separator + 1).trim(),
  };
}

export function createRipleySvcBasicAuthorization(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

export function createRipleyOrderListQuery(pageNumber: number): string {
  return new URLSearchParams({
    limit: String(ORDER_PAGE_SIZE),
    page: String(pageNumber),
  }).toString();
}

function readConfig(): RipleySvcConfig {
  const baseUrl = cleanBaseUrl(process.env.RIPLEY_SVC_URL?.trim() || DEFAULT_BASE_URL);
  const apiKey = splitApiKey(process.env.RIPLEY_SVC_API_KEY ?? '');
  const username = apiKey?.username
    ?? (process.env.RIPLEY_SVC_USERNAME?.trim() || DEFAULT_USERNAME);
  const password = apiKey?.password
    ?? cleanCredentialValue(process.env.RIPLEY_SVC_PASSWORD ?? '');

  if (!password) {
    throw new RipleySvcError(
      'Configura RIPLEY_SVC_API_KEY como usuario:contraseña o RIPLEY_SVC_PASSWORD con la contraseña vigente de Seller Center Ripley.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new RipleySvcError('RIPLEY_SVC_URL no contiene una URL válida.');
  }
  if (parsed.protocol !== 'https:') {
    throw new RipleySvcError('RIPLEY_SVC_URL debe utilizar HTTPS.');
  }

  return {
    baseUrl,
    username,
    password,
    fingerprint: createHash('sha256')
      .update(`${baseUrl}\0${username}\0${password}`)
      .digest('hex'),
  };
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function responseMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  if (typeof payload === 'string' && payload.trim()) return payload.trim().slice(0, 300);
  return fallback;
}

function tokenExpiry(token: string): number {
  try {
    const encodedPayload = token.split('.')[1];
    if (!encodedPayload) return Date.now() + TOKEN_FALLBACK_TTL_MS;
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    if (typeof payload.exp === 'number') {
      return Math.max(Date.now() + 5_000, payload.exp * 1000 - TOKEN_EXPIRY_MARGIN_MS);
    }
  } catch {
    // Some SVC environments return opaque tokens instead of JWTs.
  }
  return Date.now() + TOKEN_FALLBACK_TTL_MS;
}

async function authenticate(config: RipleySvcConfig, forceRefresh = false): Promise<string> {
  if (
    !forceRefresh
    && tokenCache?.fingerprint === config.fingerprint
    && tokenCache.expiresAt > Date.now()
  ) {
    return tokenCache.token;
  }

  const response = await fetch(`${config.baseUrl}${AUTH_PATH}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: createRipleySvcBasicAuthorization(config.username, config.password),
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await readResponsePayload(response) as RipleyAuthResponse | null;
  const token = typeof payload?.access_token === 'string' ? payload.access_token : '';

  if (!response.ok || !token) {
    if (response.status === 401 || response.status === 403) {
      const detail = responseMessage(payload, 'credenciales inválidas');
      throw new RipleySvcError(
        `Ripley rechazó el acceso API SVC (${response.status}: ${detail}). Verifica que RIPLEY_SVC_API_KEY contenga exactamente usuario:contraseña; si coincide, solicita a soporte que habilite el acceso desde servidores externos para /api/current/auth/login/vendor.`,
        response.status,
      );
    }
    throw new RipleySvcError(
      `No fue posible autenticar la API SVC de Ripley: ${responseMessage(payload, `código ${response.status}`)}.`,
      response.status,
    );
  }

  tokenCache = {
    fingerprint: config.fingerprint,
    token,
    expiresAt: tokenExpiry(token),
  };
  return token;
}

async function authenticatedFetch(
  config: RipleySvcConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await authenticate(config, attempt === 1);
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status !== 401 || attempt === 1) return response;
    tokenCache = null;
  }
  throw new RipleySvcError('No fue posible autenticar la API SVC de Ripley.');
}

function normalizeOrderList(payload: RipleyOrderListResponse): {
  total: number;
  orders: RipleyFastManagementOrder[];
} {
  const rawOrders = Array.isArray(payload.orders)
    ? payload.orders
    : Array.isArray(payload.data?.orders) ? payload.data.orders : [];
  const rawTotal = payload.total ?? payload.data?.total ?? rawOrders.length;
  const total = Number(rawTotal);
  return {
    total: Number.isFinite(total) && total >= 0 ? total : rawOrders.length,
    orders: rawOrders as RipleyFastManagementOrder[],
  };
}

async function findOrderDocuments(
  config: RipleySvcConfig,
  orderIds: readonly string[],
): Promise<Map<string, string>> {
  const wanted = new Set(orderIds);
  const documents = new Map<string, string>();
  // SVC rejects `offset` and limits greater than 25. It exposes pagination
  // through a one-based `page` parameter, even though the response reports an
  // offset. Filters such as status_management are also rejected, so we filter
  // the returned orders locally.
  const limit = ORDER_PAGE_SIZE;
  const maxPages = 160;

  for (let pageNumber = 1; pageNumber <= maxPages && documents.size < wanted.size; pageNumber += 1) {
    const query = createRipleyOrderListQuery(pageNumber);
    const response = await authenticatedFetch(
      config,
      `${FAST_MANAGEMENT_ORDERS_PATH}?${query}`,
    );
    const payload = await readResponsePayload(response) as RipleyOrderListResponse | null;
    if (!response.ok || !payload || typeof payload !== 'object') {
      throw new RipleySvcError(
        `Ripley no permitió consultar las órdenes preparables: ${responseMessage(payload, `código ${response.status}`)}.`,
        response.status,
      );
    }

    const page = normalizeOrderList(payload);
    for (const order of page.orders) {
      if (order._status_management !== 'TO_PREPARE') continue;
      const orderId = typeof order.order_id === 'string' ? order.order_id : '';
      const documentId = typeof order._id === 'string' ? order._id : '';
      if (wanted.has(orderId) && documentId) documents.set(orderId, documentId);
    }

    // Ripley can report a stale total (for example 500 while only 30 orders are
    // available), so the short page is the reliable end-of-results signal.
    if (page.orders.length < limit) break;
  }

  return documents;
}

export function parseRipleyLabelDownloadResponse(
  payload: unknown,
  requestedOrderIds: readonly string[],
): RipleyLabelDownloadResult {
  if (!payload || typeof payload !== 'object') {
    throw new RipleySvcError('Ripley devolvió una respuesta inválida al descargar las etiquetas.');
  }

  const response = payload as {
    labels_generated?: unknown;
    orders_without_labels?: unknown;
    orders_with_error?: unknown;
  };
  const rawFailures = [
    ...(Array.isArray(response.orders_without_labels) ? response.orders_without_labels : []),
    ...(Array.isArray(response.orders_with_error) ? response.orders_with_error : []),
  ] as RipleyLabelFailurePayload[];
  const failures: RipleyLabelFailure[] = rawFailures
    .map((item) => ({
      orderId: typeof item?.order_id === 'string' ? item.order_id : 'desconocida',
      message: typeof item?.status === 'string' && item.status.trim()
        ? item.status.trim()
        : typeof item?.message === 'string' && item.message.trim()
          ? item.message.trim()
        : 'Ripley no generó la etiqueta.',
    }));
  const failedIds = new Set(failures.map((item) => item.orderId));
  const encoded = typeof response.labels_generated === 'string'
    ? response.labels_generated.replace(/^data:application\/pdf;base64,/i, '').trim()
    : '';

  if (!encoded) {
    return {
      document: null,
      completedOrderIds: [],
      failures: failures.length > 0
        ? failures
        : requestedOrderIds.map((orderId) => ({
          orderId,
          message: 'Ripley no devolvió el PDF de la etiqueta.',
        })),
    };
  }

  const document = new Uint8Array(Buffer.from(encoded, 'base64'));
  if (document.length < 5 || Buffer.from(document.subarray(0, 5)).toString('ascii') !== '%PDF-') {
    throw new RipleySvcError('Ripley devolvió un archivo de etiqueta que no es un PDF válido.');
  }

  return {
    document,
    completedOrderIds: requestedOrderIds.filter((orderId) => !failedIds.has(orderId)),
    failures,
  };
}

export async function getRipleySvcConnectionStatus(): Promise<RipleySvcConnectionStatus> {
  try {
    const config = readConfig();
    await authenticate(config);
    return { configured: true, connected: true, message: null };
  } catch (error) {
    const configured = Boolean(
      splitApiKey(process.env.RIPLEY_SVC_API_KEY ?? '')
      || process.env.RIPLEY_SVC_PASSWORD,
    );
    return {
      configured,
      connected: false,
      message: ripleySvcError(error),
    };
  }
}

export async function downloadRipleyShippingLabels(
  orderIds: readonly string[],
): Promise<RipleyLabelDownloadResult> {
  const uniqueOrderIds = [...new Set(orderIds.filter(Boolean))];
  if (uniqueOrderIds.length === 0) {
    throw new RipleySvcError('No se recibieron órdenes Ripley para descargar.');
  }

  const config = readConfig();
  const documents = await findOrderDocuments(config, uniqueOrderIds);
  const missing = uniqueOrderIds.filter((orderId) => !documents.has(orderId));
  const downloadable = uniqueOrderIds.filter((orderId) => documents.has(orderId));

  if (downloadable.length === 0) {
    return {
      document: null,
      completedOrderIds: [],
      failures: missing.map((orderId) => ({
        orderId,
        message: 'La orden no está en estado TO_PREPARE dentro de Seller Center Ripley.',
      })),
    };
  }

  const response = await authenticatedFetch(config, LABEL_DOWNLOAD_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orders: downloadable.map((orderId) => ({ document_id: documents.get(orderId) })),
    }),
  });
  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw new RipleySvcError(
      `Ripley rechazó la descarga de etiquetas: ${responseMessage(payload, `código ${response.status}`)}.`,
      response.status,
    );
  }

  const result = parseRipleyLabelDownloadResponse(payload, downloadable);
  return {
    ...result,
    failures: [
      ...result.failures,
      ...missing.map((orderId) => ({
        orderId,
        message: 'La orden no está en estado TO_PREPARE dentro de Seller Center Ripley.',
      })),
    ],
  };
}

export function ripleySvcError(error: unknown): string {
  if (error instanceof RipleySvcError) return error.message.slice(0, 500);
  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'Seller Center Ripley tardó demasiado en responder.';
  }
  if (error instanceof Error) return error.message.slice(0, 500);
  return 'No fue posible comunicarse con Seller Center Ripley.';
}
