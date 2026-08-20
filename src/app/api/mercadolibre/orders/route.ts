process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import {
  getMercadoLibreOrderIdsToRecheck,
  upsertMercadoLibreOrder,
} from '@/app/lib/actions/order-actions';
import { MARKETPLACES } from '@/app/lib/constants/marketplaces';
import { getValidAccessToken } from '@/app/lib/mercadolibre/token-manager';
import {
  extractReturnShippingStatuses,
  getMercadoLibreInvoiceData,
  getMercadoLibreMarketplaceItemId,
  inferMercadoLibreDocumentType,
  isCertainFullLineReturn,
  isMercadoLibreReturnClaim,
} from '@/app/lib/mercadolibre/order-sync';
import {
  aggregateMercadoLibreOrderStatuses,
  resolveMercadoLibreOrderStatus,
} from '@/app/lib/orders/marketplace-status-mappers';
import {
  normalizeMarketplaceOrderItemStatus,
  STANDARD_ORDER_ITEM_STATUSES,
} from '@/app/lib/orders/order-item-status';
import {
  ORDER_STATUSES,
  type StandardOrderStatus,
} from '@/app/lib/orders/order-status';
import { getMarketplaceSyncMode } from '@/app/lib/orders/marketplace-sync';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MERCADO_LIBRE_API = 'https://api.mercadolibre.com';
const SITE_ID = 'MLC';
const SEARCH_PAGE_SIZE = 50;

interface MercadoLibreOrderItem {
  item?: { id?: unknown; title?: unknown } | null;
  quantity?: unknown;
  unit_price?: unknown;
  variation_id?: unknown;
}

interface MercadoLibreOrder {
  id?: unknown;
  pack_id?: unknown;
  status?: unknown;
  shipping?: { id?: unknown } | null;
  shipping_cost?: unknown;
  order_items?: MercadoLibreOrderItem[] | null;
  buyer?: { billing_info?: { id?: unknown } | null } | null;
}

interface MercadoLibrePack {
  orders?: Array<{ id?: unknown }>;
}

interface MercadoLibreShipment {
  status?: unknown;
  shipping_option?: {
    cost?: unknown;
    estimated_delivery_time?: { date?: unknown } | null;
  } | null;
  lead_time?: {
    estimated_delivery_time?: { date?: unknown } | null;
  } | null;
  estimated_delivery_time?: { date?: unknown } | null;
}

interface MercadoLibreClaim {
  id?: unknown;
  type?: unknown;
  related_entities?: unknown;
  quantity_type?: unknown;
  claimed_quantity?: unknown;
}

interface SearchResponse<T> {
  results?: T[];
  data?: T[];
  paging?: { total?: number; offset?: number; limit?: number };
}

class MercadoLibreApiError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly responseBody: string,
  ) {
    super(`Mercado Libre ${status} en ${url}: ${responseBody}`);
    this.name = 'MercadoLibreApiError';
  }
}

interface ReturnClaimsCheckStats {
  accessDenied: boolean;
  checkedOrders: number;
  skippedOrders: number;
  failedOrders: number;
  claimsFound: number;
  returnsFound: number;
  deliveredReturns: number;
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }
  return null;
}

function numericValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function mercadoLibreGet<T>(
  pathOrUrl: string,
  token: string,
  options: { allowNotFound?: boolean; headers?: Record<string, string> } = {},
): Promise<T | null> {
  const url = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `${MERCADO_LIBRE_API}${pathOrUrl}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (response.status === 404 && options.allowNotFound) return null;
  if (!response.ok) {
    const body = await response.text();
    throw new MercadoLibreApiError(response.status, url, body);
  }

  return await response.json() as T;
}

async function fetchUpdatedOrderIds(
  sellerId: string,
  token: string,
): Promise<string[]> {
  const syncDays = positiveIntegerEnv('MERCADO_LIBRE_SYNC_DAYS', 30);
  const updatedFrom = new Date(
    Date.now() - syncDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const orderIds = new Set<string>();
  let offset = 0;

  for (let page = 0; page < 200; page += 1) {
    const params = new URLSearchParams({
      seller: sellerId,
      sort: 'date_desc',
      'order.date_last_updated.from': updatedFrom,
      limit: String(SEARCH_PAGE_SIZE),
      offset: String(offset),
    });
    const response = await mercadoLibreGet<SearchResponse<MercadoLibreOrder>>(
      `/orders/search?${params.toString()}`,
      token,
    );
    const orders = response?.results ?? [];

    for (const order of orders) {
      const id = stringValue(order.id);
      if (id) orderIds.add(id);
    }

    offset += orders.length;
    const total = numericValue(response?.paging?.total);
    if (orders.length === 0 || offset >= total) break;
  }

  return [...orderIds];
}

async function hydrateOrdersAndPacks(
  initialIds: readonly string[],
  token: string,
): Promise<MercadoLibreOrder[]> {
  const queue = [...new Set(initialIds)];
  const queuedIds = new Set(queue);
  const orders = new Map<string, MercadoLibreOrder>();
  const loadedPacks = new Set<string>();

  const enqueuePackOrders = async (packId: string) => {
    if (loadedPacks.has(packId)) return;
    loadedPacks.add(packId);
    const pack = await mercadoLibreGet<MercadoLibrePack>(
      `/packs/${encodeURIComponent(packId)}`,
      token,
      { allowNotFound: true },
    );

    for (const packOrder of pack?.orders ?? []) {
      const orderId = stringValue(packOrder.id);
      if (orderId && !queuedIds.has(orderId)) {
        queuedIds.add(orderId);
        queue.push(orderId);
      }
    }
  };

  for (let index = 0; index < queue.length; index += 1) {
    const externalId = queue[index];
    try {
      const order = await mercadoLibreGet<MercadoLibreOrder>(
        `/orders/${encodeURIComponent(externalId)}`,
        token,
        { allowNotFound: true },
      );

      if (!order) {
        await enqueuePackOrders(externalId);
        continue;
      }

      const orderId = stringValue(order.id);
      if (!orderId) continue;
      orders.set(orderId, order);

      const packId = stringValue(order.pack_id);
      if (packId) await enqueuePackOrders(packId);
    } catch (error) {
      console.warn(`[MercadoLibre] No se pudo hidratar orden/pack ${externalId}:`, error);
    }
  }

  return [...orders.values()];
}

function getShipmentDeliveryDate(shipment: MercadoLibreShipment | null): string | null {
  return (
    stringValue(shipment?.lead_time?.estimated_delivery_time?.date) ??
    stringValue(shipment?.shipping_option?.estimated_delivery_time?.date) ??
    stringValue(shipment?.estimated_delivery_time?.date)
  );
}

async function fetchReturnClaims(
  orderId: string,
  token: string,
): Promise<MercadoLibreClaim[]> {
  const claims: MercadoLibreClaim[] = [];
  let offset = 0;

  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({
      order_id: orderId,
      limit: '50',
      offset: String(offset),
    });
    const response = await mercadoLibreGet<SearchResponse<MercadoLibreClaim>>(
      `/post-purchase/v1/claims/search?${params.toString()}`,
      token,
      { allowNotFound: true },
    );
    const pageClaims = response?.data ?? [];
    claims.push(...pageClaims);
    offset += pageClaims.length;
    const total = numericValue(response?.paging?.total);
    if (pageClaims.length === 0 || offset >= total) break;
  }

  return claims;
}

async function fetchReturnState(
  order: MercadoLibreOrder,
  token: string,
  stats: ReturnClaimsCheckStats,
): Promise<{
  returned: boolean;
  marketplaceStatus: string | null;
  checked: boolean;
}> {
  const orderId = stringValue(order.id);
  if (!orderId) {
    return { returned: false, marketplaceStatus: null, checked: false };
  }

  if (stats.accessDenied) {
    stats.skippedOrders += 1;
    return { returned: false, marketplaceStatus: null, checked: false };
  }

  try {
    const claims = await fetchReturnClaims(orderId, token);
    stats.checkedOrders += 1;
    stats.claimsFound += claims.length;
    let latestReturnStatus: string | null = null;

    for (const claim of claims) {
      const claimId = stringValue(claim.id);
      if (!claimId) continue;

      const claimDetails = await mercadoLibreGet<MercadoLibreClaim>(
        `/post-purchase/v1/claims/${encodeURIComponent(claimId)}`,
        token,
        { allowNotFound: true },
      );
      const effectiveClaim = claimDetails ?? claim;
      const identifiedAsReturn = isMercadoLibreReturnClaim(effectiveClaim);

      const returnPayload = await mercadoLibreGet<unknown>(
        `/post-purchase/v2/claims/${encodeURIComponent(claimId)}/returns`,
        token,
        { allowNotFound: true },
      );
      if (!returnPayload) {
        if (identifiedAsReturn) {
          console.warn(
            `[MercadoLibre][Returns] Claim ${claimId} de order ${orderId} ` +
            'indica devolucion, pero el recurso returns respondio 404.',
          );
        }
        continue;
      }

      stats.returnsFound += 1;
      const statuses = extractReturnShippingStatuses(returnPayload);
      const delivered = statuses.includes('delivered');
      latestReturnStatus = delivered
        ? 'delivered'
        : statuses.at(-1) ?? latestReturnStatus;

      if (!delivered) continue;
      stats.deliveredReturns += 1;

      const orderItems = order.order_items ?? [];
      const totalQuantity = orderItems.reduce(
        (sum, item) => sum + Math.max(0, numericValue(item.quantity)),
        0,
      );
      if (isCertainFullLineReturn(
        effectiveClaim,
        totalQuantity,
        orderItems.length,
      )) {
        return {
          returned: true,
          marketplaceStatus: 'delivered',
          checked: true,
        };
      }

      console.warn(
        `[MercadoLibre][Returns] Devolucion parcial o cantidad ambigua para order ${orderId}; no se marcara toda la linea como devuelta.`,
        JSON.stringify({ claim, returnPayload, orderItems }),
      );
    }

    return {
      returned: false,
      marketplaceStatus: latestReturnStatus,
      checked: true,
    };
  } catch (error) {
    stats.failedOrders += 1;

    if (
      error instanceof MercadoLibreApiError &&
      error.status === 403 &&
      error.responseBody.includes('PA_UNAUTHORIZED_RESULT_FROM_POLICIES')
    ) {
      stats.accessDenied = true;
      console.warn(
        '[MercadoLibre][Returns] La aplicacion no tiene permiso para Claims/Returns. ' +
        'Se omitiran las revisiones restantes de esta sincronizacion.',
      );
      return { returned: false, marketplaceStatus: null, checked: false };
    }

    console.warn(`[MercadoLibre][Returns] No se pudo revisar order ${orderId}:`, error);
    return { returned: false, marketplaceStatus: null, checked: false };
  }
}

export async function GET(request: NextRequest) {
  const sellerId = process.env.MERCADO_LIBRE_SELLER_ID;
  const token = await getValidAccessToken();
  const requestedOrderId = request.nextUrl.searchParams.get('orderId')?.trim();
  const mode = getMarketplaceSyncMode(request.nextUrl.searchParams);
  const shouldCheckReturns = mode === 'returns' || Boolean(requestedOrderId);

  if (!sellerId || !token) {
    return NextResponse.json(
      { error: 'Faltan credenciales de Mercado Libre' },
      { status: 400 },
    );
  }

  if (requestedOrderId && !/^\d+$/.test(requestedOrderId)) {
    return NextResponse.json(
      { error: 'orderId debe contener solamente numeros' },
      { status: 400 },
    );
  }

  try {
    const recheckDays = positiveIntegerEnv(
      'MERCADO_LIBRE_RETURN_RECHECK_DAYS',
      60,
    );
    let updatedOrderIds: string[];
    let existingOrderIds: string[];
    if (requestedOrderId) {
      updatedOrderIds = [requestedOrderId];
      existingOrderIds = [];
    } else if (mode === 'returns') {
      updatedOrderIds = [];
      existingOrderIds = await getMercadoLibreOrderIdsToRecheck(recheckDays);
    } else {
      updatedOrderIds = await fetchUpdatedOrderIds(sellerId, token);
      existingOrderIds = [];
    }
    const orders = await hydrateOrdersAndPacks(
      [...updatedOrderIds, ...existingOrderIds],
      token,
    );
    const groupedOrders = new Map<string, MercadoLibreOrder[]>();

    for (const order of orders) {
      const orderId = stringValue(order.id);
      if (!orderId) continue;
      const headerOrderId = stringValue(order.pack_id) ?? orderId;
      const group = groupedOrders.get(headerOrderId) ?? [];
      group.push(order);
      groupedOrders.set(headerOrderId, group);
    }

    const shipmentCache = new Map<string, Promise<MercadoLibreShipment | null>>();
    const shipmentSlaCache = new Map<string, Promise<string | null>>();
    const billingCache = new Map<string, Promise<unknown | null>>();
    const synchronizedOrders = [];
    const returnClaimsStats: ReturnClaimsCheckStats = {
      accessDenied: false,
      checkedOrders: 0,
      skippedOrders: 0,
      failedOrders: 0,
      claimsFound: 0,
      returnsFound: 0,
      deliveredReturns: 0,
    };

    const getShipment = (shipmentId: string) => {
      let request = shipmentCache.get(shipmentId);
      if (!request) {
        request = mercadoLibreGet<MercadoLibreShipment>(
          `/shipments/${encodeURIComponent(shipmentId)}`,
          token,
          {
            allowNotFound: true,
            headers: { 'x-format-new': 'true' },
          },
        ).catch((error) => {
          console.warn(
            `[MercadoLibre][Shipping] No se pudo obtener shipment ${shipmentId}:`,
            error,
          );
          return null;
        });
        shipmentCache.set(shipmentId, request);
      }
      return request;
    };

    const getShipmentSlaDate = (shipmentId: string) => {
      let request = shipmentSlaCache.get(shipmentId);
      if (!request) {
        request = mercadoLibreGet<{ expected_date?: unknown }>(
          `/shipments/${encodeURIComponent(shipmentId)}/sla`,
          token,
          { allowNotFound: true },
        ).then((sla) => stringValue(sla?.expected_date)).catch((error) => {
          console.warn(
            `[MercadoLibre][Shipping] No se pudo obtener SLA ${shipmentId}:`,
            error,
          );
          return null;
        });
        shipmentSlaCache.set(shipmentId, request);
      }
      return request;
    };

    const getBillingInfo = (billingInfoId: string) => {
      let request = billingCache.get(billingInfoId);
      if (!request) {
        request = mercadoLibreGet<unknown>(
          `/orders/billing-info/${SITE_ID}/${encodeURIComponent(billingInfoId)}`,
          token,
          { allowNotFound: true },
        ).catch((error) => {
          console.warn(
            `[MercadoLibre][Billing] No se pudo obtener billing_info ${billingInfoId}:`,
            error,
          );
          return null;
        });
        billingCache.set(billingInfoId, request);
      }
      return request;
    };

    for (const [headerOrderId, packOrders] of groupedOrders) {
      const items = [];
      const orderStatuses: StandardOrderStatus[] = [];
      const uniqueShipments = new Map<string, MercadoLibreShipment>();
      const deliveryDates: string[] = [];
      const fallbackShippingAmounts: number[] = [];
      const invoicePayloads: unknown[] = [];
      let packReturnsChecked = true;

      for (const order of packOrders) {
        const marketplaceOrderId = stringValue(order.id);
        if (!marketplaceOrderId) continue;

        const shipmentId = stringValue(order.shipping?.id);
        const shipment = shipmentId ? await getShipment(shipmentId) : null;
        if (shipmentId && shipment) uniqueShipments.set(shipmentId, shipment);

        const shipmentStatus = stringValue(shipment?.status);
        const rawForwardStatus = shipmentStatus ?? stringValue(order.status);
        const standardizedStatus = resolveMercadoLibreOrderStatus(
          stringValue(order.status),
          shipmentStatus,
        );

        const deliveryDate = getShipmentDeliveryDate(shipment) ?? (
          shipmentId ? await getShipmentSlaDate(shipmentId) : null
        );
        if (deliveryDate) deliveryDates.push(deliveryDate);
        fallbackShippingAmounts.push(numericValue(order.shipping_cost));

        const billingInfoId = stringValue(order.buyer?.billing_info?.id);
        if (billingInfoId) {
          const billingPayload = await getBillingInfo(billingInfoId);
          if (billingPayload) invoicePayloads.push(billingPayload);
        }

        const returnState = shouldCheckReturns
          ? await fetchReturnState(order, token, returnClaimsStats)
          : { returned: false, marketplaceStatus: null, checked: false };
        if (shouldCheckReturns && !returnState.checked) {
          packReturnsChecked = false;
        }
        orderStatuses.push(
          returnState.returned
            ? ORDER_STATUSES.RETURNED
            : standardizedStatus,
        );
        for (const orderItem of order.order_items ?? []) {
          const quantity = Math.max(1, Math.trunc(numericValue(orderItem.quantity, 1)));
          const productTitle = stringValue(orderItem.item?.title) ?? 'Sin titulo';
          const itemStatus = returnState.returned
            ? STANDARD_ORDER_ITEM_STATUSES.RETURNED
            : normalizeMarketplaceOrderItemStatus(
                MARKETPLACES.MERCADO_LIBRE,
                rawForwardStatus,
              );

          items.push({
            marketplaceOrderId,
            marketplaceItemId: getMercadoLibreMarketplaceItemId(orderItem),
            productTitle,
            productQuantity: quantity,
            productPrice: numericValue(orderItem.unit_price),
            status: itemStatus,
            marketplaceStatus: returnState.marketplaceStatus ?? rawForwardStatus,
          });
        }
      }

      if (items.length === 0) {
        console.warn(`[MercadoLibre] Pack/order ${headerOrderId} sin items; se omite.`);
        continue;
      }

      const shipmentAmounts = [...uniqueShipments.values()]
        .map((shipment) => numericValue(shipment.shipping_option?.cost))
        .filter((amount) => amount > 0);
      const shippingAmount = shipmentAmounts.length > 0
        ? shipmentAmounts.reduce((sum, amount) => sum + amount, 0)
        : Math.max(0, ...fallbackShippingAmounts);
      const documentType = invoicePayloads.some(
        (payload) => inferMercadoLibreDocumentType(payload) === 'factura',
      ) ? 'factura' : 'boleta';
      const normalizedInvoiceData = invoicePayloads.map(getMercadoLibreInvoiceData);
      const invoiceData = {
        companyRut: normalizedInvoiceData.find((data) => data.companyRut)?.companyRut ?? null,
        billingCity: normalizedInvoiceData.find((data) => data.billingCity)?.billingCity ?? null,
      };

      const result = await upsertMercadoLibreOrder({
        orderId: headerOrderId,
        shippingAmount,
        status: aggregateMercadoLibreOrderStatuses(orderStatuses),
        documentType,
        deliveryDate: deliveryDates.sort()[0] ?? null,
        companyRut: invoiceData.companyRut,
        billingCity: invoiceData.billingCity,
        items,
      });
      synchronizedOrders.push({
        ...result,
        returnCheckStatus: shouldCheckReturns
          ? packReturnsChecked ? 'checked' : 'not_checked'
          : 'not_requested',
      });
    }

    return NextResponse.json({
      mode,
      synchronized: synchronizedOrders.length,
      updatedCandidates: updatedOrderIds.length,
      recheckedCandidates: existingOrderIds.length,
      requestedOrderId: requestedOrderId ?? null,
      returnChecks: {
        status: !shouldCheckReturns
          ? 'not_requested'
          : returnClaimsStats.accessDenied
            ? 'unauthorized'
            : returnClaimsStats.failedOrders > 0
              ? 'partial'
              : 'completed',
        checkedOrders: returnClaimsStats.checkedOrders,
        skippedOrders: returnClaimsStats.skippedOrders,
        failedOrders: returnClaimsStats.failedOrders,
        claimsFound: returnClaimsStats.claimsFound,
        returnsFound: returnClaimsStats.returnsFound,
        deliveredReturns: returnClaimsStats.deliveredReturns,
        message: returnClaimsStats.accessDenied
          ? 'La aplicacion de Mercado Libre no tiene habilitado el permiso de Claims/Returns.'
          : null,
      },
      results: synchronizedOrders,
    });
  } catch (error) {
    console.error('Error en la API de Mercado Libre:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error desconocido' },
      { status: 500 },
    );
  }
}
