import {
  getActiveWalmartOrderIds,
  upsertWalmartOrder,
} from '@/app/lib/actions/order-actions';
import {
  collectWalmartReturnSummaries,
  expandWalmartOrderLineUnits,
  findWalmartFiscalSignals,
  getWalmartDeliveryDate,
  getWalmartOrderDate,
  getWalmartRawLineStatuses,
  getWalmartShippingAmount,
  normalizeWalmartCursor,
  resolveWalmartOrderStatus,
  toArray,
  type WalmartOrder,
  type WalmartReturnOrder,
} from '@/app/lib/walmart/order-sync';
import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

const WALMART_API_BASE = 'https://marketplace.walmartapis.com';
const WALMART_GLOBAL_VERSION = '3.1';
const ORDER_PAGE_SIZE = 200;
const RETURN_PAGE_SIZE = 100;
const MAX_PAGES = 100;
const FETCH_CONCURRENCY = 5;

interface WalmartTokenResponse {
  access_token?: string;
  expires_in?: number | string;
}

interface WalmartOrdersResponse {
  list?: {
    meta?: { nextCursor?: string | null };
    elements?: { order?: WalmartOrder | WalmartOrder[] | null };
  };
  order?: WalmartOrder;
}

interface WalmartReturnsResponse {
  meta?: { nextCursorMark?: string | null };
  returnOrders?: WalmartReturnOrder[] | WalmartReturnOrder | null;
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

function readDays(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toBasicAuth(clientId: string, clientSecret: string): string {
  return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

function credentials() {
  const clientId = process.env.WALMART_CLIENT_ID;
  const clientSecret = process.env.WALMART_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan credenciales de Walmart');
  }
  return { clientId, clientSecret };
}

function requestHeaders(accessToken?: string): Record<string, string> {
  const { clientId, clientSecret } = credentials();
  return {
    Authorization: `Basic ${toBasicAuth(clientId, clientSecret)}`,
    ...(accessToken ? { 'WM_SEC.ACCESS_TOKEN': accessToken } : {}),
    WM_MARKET: 'cl',
    WM_GLOBAL_VERSION: WALMART_GLOBAL_VERSION,
    'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
    'WM_SVC.NAME': 'Walmart Marketplace',
    Accept: 'application/json',
  };
}

async function getWalmartToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const response = await fetch(`${WALMART_API_BASE}/v3/token`, {
    method: 'POST',
    headers: {
      ...requestHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });
  const body = await response.text();
  let payload: WalmartTokenResponse;
  try {
    payload = JSON.parse(body) as WalmartTokenResponse;
  } catch {
    throw new Error(`Walmart Token API respondio ${response.status}: ${body.slice(0, 500)}`);
  }
  if (!response.ok || !payload.access_token) {
    throw new Error(`Walmart Token API respondio ${response.status}: ${body.slice(0, 500)}`);
  }

  const expiresInSeconds = Math.max(60, Number(payload.expires_in ?? 900));
  cachedToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };
  return cachedToken.accessToken;
}

async function walmartJson<T>(
  accessToken: string,
  pathAndQuery: string,
): Promise<T> {
  const response = await fetch(`${WALMART_API_BASE}${pathAndQuery}`, {
    headers: requestHeaders(accessToken),
    cache: 'no-store',
  });
  const body = await response.text();
  let payload: T;
  try {
    payload = JSON.parse(body) as T;
  } catch {
    throw new Error(`Walmart respondio ${response.status}: ${body.slice(0, 500)}`);
  }
  if (!response.ok) {
    throw new Error(`Walmart respondio ${response.status}: ${body.slice(0, 500)}`);
  }
  return payload;
}

async function fetchWalmartOrder(
  accessToken: string,
  purchaseOrderId: string,
): Promise<WalmartOrder> {
  const payload = await walmartJson<WalmartOrdersResponse>(
    accessToken,
    `/v3/orders/${encodeURIComponent(purchaseOrderId)}`,
  );
  if (!payload.order?.purchaseOrderId) {
    throw new Error(`Walmart no devolvio la orden ${purchaseOrderId}`);
  }
  return payload.order;
}

async function fetchWalmartOrderPages(
  accessToken: string,
  filters: Readonly<Record<string, string>>,
): Promise<WalmartOrder[]> {
  const initialQuery = new URLSearchParams({
    ...filters,
    limit: String(ORDER_PAGE_SIZE),
  });
  let query: string | null = initialQuery.toString();
  const orders: WalmartOrder[] = [];

  for (let page = 0; page < MAX_PAGES && query; page += 1) {
    const payload = await walmartJson<WalmartOrdersResponse>(
      accessToken,
      `/v3/orders?${query}`,
    );
    orders.push(...toArray(payload.list?.elements?.order));
    query = normalizeWalmartCursor(payload.list?.meta?.nextCursor);
  }
  if (query) {
    console.warn(`[Walmart] Se alcanzo el limite de ${MAX_PAGES} paginas de ordenes.`);
  }
  return orders;
}

async function fetchWalmartReturnPages(
  accessToken: string,
  filters: Readonly<Record<string, string>>,
): Promise<WalmartReturnOrder[]> {
  const initialQuery = new URLSearchParams({
    ...filters,
    limit: String(RETURN_PAGE_SIZE),
  });
  let query: string | null = initialQuery.toString();
  const returns: WalmartReturnOrder[] = [];

  for (let page = 0; page < MAX_PAGES && query; page += 1) {
    const payload = await walmartJson<WalmartReturnsResponse>(
      accessToken,
      `/v3/returns?${query}`,
    );
    returns.push(...toArray(payload.returnOrders));
    query = normalizeWalmartCursor(payload.meta?.nextCursorMark);
  }
  if (query) {
    console.warn(`[Walmart] Se alcanzo el limite de ${MAX_PAGES} paginas de devoluciones.`);
  }
  return returns;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += FETCH_CONCURRENCY) {
    results.push(
      ...(await Promise.all(
        values.slice(index, index + FETCH_CONCURRENCY).map(mapper),
      )),
    );
  }
  return results;
}

function syncWindow(days: number) {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    startTimestamp: start.toISOString(),
    endTimestamp: end.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const requestedPurchaseOrderId =
    request.nextUrl.searchParams.get('purchaseOrderId')?.trim() || undefined;
  const debug = request.nextUrl.searchParams.get('debug') === 'true';
  const syncDays = readDays(process.env.WALMART_SYNC_DAYS, 4);
  const returnSyncDays = readDays(process.env.WALMART_RETURN_SYNC_DAYS, 4);

  try {
    const accessToken = await getWalmartToken();
    const orders = new Map<string, WalmartOrder>();
    let recentCandidates = 0;
    let activeCandidates = 0;
    let returnCandidates = 0;
    let returnOrders: WalmartReturnOrder[] = [];

    if (requestedPurchaseOrderId) {
      const order = await fetchWalmartOrder(accessToken, requestedPurchaseOrderId);
      orders.set(String(order.purchaseOrderId), order);
      const customerOrderId = String(order.customerOrderId ?? '').trim();
      if (customerOrderId) {
        returnOrders = await fetchWalmartReturnPages(accessToken, { customerOrderId });
      }
    } else {
      const orderWindow = syncWindow(syncDays);
      const returnWindow = syncWindow(returnSyncDays);
      const [recentOrders, activeOrderIds, recentReturns] = await Promise.all([
        fetchWalmartOrderPages(accessToken, {
          createdStartDate: orderWindow.startDate,
          createdEndDate: orderWindow.endDate,
        }),
        getActiveWalmartOrderIds(),
        fetchWalmartReturnPages(accessToken, {
          returnLastModifiedStartDate: returnWindow.startTimestamp,
          returnLastModifiedEndDate: returnWindow.endTimestamp,
        }),
      ]);

      recentCandidates = recentOrders.length;
      activeCandidates = activeOrderIds.length;
      returnOrders = recentReturns;
      returnCandidates = recentReturns.length;
      for (const order of recentOrders) {
        const purchaseOrderId = String(order.purchaseOrderId ?? '').trim();
        if (purchaseOrderId) orders.set(purchaseOrderId, order);
      }

      const returnPurchaseOrderIds = new Set<string>();
      for (const returnOrder of recentReturns) {
        for (const line of toArray(returnOrder.returnOrderLines)) {
          const purchaseOrderId = String(line.purchaseOrderId ?? '').trim();
          if (purchaseOrderId) returnPurchaseOrderIds.add(purchaseOrderId);
        }
      }
      const idsToFetch = Array.from(
        new Set([...activeOrderIds, ...returnPurchaseOrderIds]),
      ).filter((purchaseOrderId) => !orders.has(purchaseOrderId));
      const refreshedOrders = await mapWithConcurrency(
        idsToFetch,
        (purchaseOrderId) => fetchWalmartOrder(accessToken, purchaseOrderId),
      );
      for (const order of refreshedOrders) {
        const purchaseOrderId = String(order.purchaseOrderId ?? '').trim();
        if (purchaseOrderId) orders.set(purchaseOrderId, order);
      }
    }

    const returnSummaries = collectWalmartReturnSummaries(returnOrders);
    const results = [];
    const diagnostics = [];

    for (const [purchaseOrderId, order] of orders) {
      const orderLines = toArray(order.orderLines?.orderLine);
      const items = orderLines.flatMap((line, lineIndex) =>
        expandWalmartOrderLineUnits(
          purchaseOrderId,
          line,
          lineIndex,
          returnSummaries,
        ),
      );
      const normalizedOrderStatus = resolveWalmartOrderStatus(
        items.map((item) => item.status),
      );
      const result = await upsertWalmartOrder({
        orderId: purchaseOrderId,
        orderDate: getWalmartOrderDate(order),
        shippingAmount: getWalmartShippingAmount(order),
        status: normalizedOrderStatus,
        deliveryDate: getWalmartDeliveryDate(order),
        items,
      });
      if ('error' in result) {
        throw new Error(`No se pudo sincronizar Walmart ${purchaseOrderId}: ${result.error}`);
      }
      results.push({ purchaseOrderId, ...result });

      if (debug) {
        diagnostics.push({
          purchaseOrderId,
          customerOrderId: order.customerOrderId ?? null,
          normalizedOrderStatus,
          documentType: 'boleta',
          fiscalSignals: findWalmartFiscalSignals(order),
          kycDetailsPresent: order.kycDetails != null,
          shippingAmount: getWalmartShippingAmount(order),
          orderDate: getWalmartOrderDate(order),
          deliveryDate: getWalmartDeliveryDate(order),
          items: items.map((item) => {
            const baseItemId = item.marketplaceItemId.split(':unit:')[0];
            const sourceLine = orderLines.find(
              (line) => `${purchaseOrderId}:${String(line.lineNumber)}` === baseItemId,
            );
            return {
              marketplaceItemId: item.marketplaceItemId,
              rawStatuses: sourceLine
                ? getWalmartRawLineStatuses(sourceLine).map((status) => status.status)
                : [],
              marketplaceStatus: item.marketplaceStatus,
              normalizedStatus: item.status,
              productQuantity: item.productQuantity,
              productPrice: item.productPrice,
            };
          }),
        });
      }
    }

    return NextResponse.json({
      synchronized: results.length,
      recentCandidates,
      activeCandidates,
      returnCandidates,
      requestedPurchaseOrderId: requestedPurchaseOrderId ?? null,
      syncDays: requestedPurchaseOrderId ? null : syncDays,
      returnSyncDays: requestedPurchaseOrderId ? null : returnSyncDays,
      results,
      ...(debug ? { diagnostics } : {}),
    });
  } catch (error) {
    console.error('Error en la API de Walmart:', error);
    return NextResponse.json(
      {
        error: 'Error en la API de Walmart',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
