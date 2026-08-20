import { upsertParisOrder } from '@/app/lib/actions/order-actions';
import { MARKETPLACES } from '@/app/lib/constants/marketplaces';
import {
  getParisDeliveryDate,
  getParisDocumentType,
  getParisInvoiceData,
  getParisMarketplaceItemId,
  getParisRawStatus,
  getParisShippingAmount,
  parseParisMoney,
  type ParisOrderPayload,
  type ParisSubOrderPayload,
} from '@/app/lib/paris/order-sync';
import {
  normalizeMarketplaceOrderItemStatus,
} from '@/app/lib/orders/order-item-status';
import { resolveParisOrderStatus } from '@/app/lib/orders/marketplace-status-mappers';
import { getMarketplaceSyncMode } from '@/app/lib/orders/marketplace-sync';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

dayjs.extend(utc);
dayjs.extend(timezone);

const PARIS_API_URL = 'https://api-developers.ecomm.cencosud.com/v1/orders';
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

interface ParisApiResponse {
  data?: ParisOrderPayload[];
}

interface ParisCandidate {
  order: ParisOrderPayload;
  subOrder: ParisSubOrderPayload;
}

function readDays(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function syncWindow(days: number) {
  const now = dayjs().tz('America/Santiago');
  return {
    from: now.subtract(days, 'day').format('YYYY-MM-DD'),
    to: now.add(1, 'day').format('YYYY-MM-DD'),
  };
}

async function fetchParisOrders(
  accessToken: string,
  sellerId: string,
  filters: Record<string, string>,
): Promise<ParisOrderPayload[]> {
  const orders: ParisOrderPayload[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(PARIS_API_URL);
    url.searchParams.set('sellerId', sellerId);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(page * PAGE_SIZE));

    for (const [key, value] of Object.entries(filters)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Paris GET /v1/orders respondio ${response.status}: ${body.slice(0, 500)}`,
      );
    }

    const payload = (await response.json()) as ParisApiResponse;
    const pageOrders = Array.isArray(payload.data) ? payload.data : [];
    orders.push(...pageOrders);

    // `count` puede ser global y no representar el filtro actual.
    if (pageOrders.length < PAGE_SIZE) return orders;
  }

  console.warn(
    `[Paris] Se alcanzo el limite defensivo de ${MAX_PAGES} paginas para ${JSON.stringify(filters)}`,
  );
  return orders;
}

function collectCandidates(
  orders: readonly ParisOrderPayload[],
  requestedSubOrderNumber?: string,
): ParisCandidate[] {
  const candidates: ParisCandidate[] = [];

  for (const order of orders) {
    for (const subOrder of order.subOrders ?? []) {
      const subOrderNumber = String(subOrder.subOrderNumber ?? '').trim();
      if (!subOrderNumber) continue;
      if (requestedSubOrderNumber && subOrderNumber !== requestedSubOrderNumber) {
        continue;
      }
      candidates.push({ order, subOrder });
    }
  }

  return candidates;
}

export async function GET(request: NextRequest) {
  const accessToken = process.env.PARIS_ACCESS_TOKEN;
  const sellerId = process.env.PARIS_SELLER_ID;

  if (!accessToken || !sellerId) {
    return NextResponse.json(
      { error: 'Faltan credenciales de Paris' },
      { status: 400 },
    );
  }

  const requestedSubOrderNumber =
    request.nextUrl.searchParams.get('subOrderNumber')?.trim() || undefined;
  const debug = request.nextUrl.searchParams.get('debug') === 'true';
  const mode = getMarketplaceSyncMode(request.nextUrl.searchParams);
  const syncDays = readDays(process.env.PARIS_SYNC_DAYS, 4);
  const returnRecheckDays = readDays(process.env.PARIS_RETURN_RECHECK_DAYS, 60);

  try {
    let recentOrders: ParisOrderPayload[];
    let historicalOrders: ParisOrderPayload[];

    if (requestedSubOrderNumber) {
      recentOrders = await fetchParisOrders(accessToken, sellerId, {
        subOrderNumber: requestedSubOrderNumber,
      });
      historicalOrders = [];
    } else if (mode === 'returns') {
      const returnWindow = syncWindow(returnRecheckDays);
      recentOrders = [];
      historicalOrders = await fetchParisOrders(accessToken, sellerId, {
        gteUpdatedAt: returnWindow.from,
        lteUpdatedAt: returnWindow.to,
      });
    } else {
      const recentWindow = syncWindow(syncDays);
      recentOrders = await fetchParisOrders(accessToken, sellerId, {
        gteUpdatedAt: recentWindow.from,
        lteUpdatedAt: recentWindow.to,
      });
      historicalOrders = [];
    }

    const recentCandidates = collectCandidates(
      recentOrders,
      requestedSubOrderNumber,
    );
    const historicalCandidates = collectCandidates(historicalOrders);
    const candidates = new Map<string, ParisCandidate>();

    for (const candidate of [...recentCandidates, ...historicalCandidates]) {
      const subOrderNumber = String(candidate.subOrder.subOrderNumber).trim();
      candidates.set(subOrderNumber, candidate);
    }

    const results = [];
    const diagnostics = [];

    for (const [subOrderNumber, { order, subOrder }] of candidates) {
      const documentType = getParisDocumentType(order, subOrder);
      const invoiceData = documentType === 'factura'
        ? getParisInvoiceData(order, subOrder)
        : { companyRut: null, billingCity: null };
      const rawOrderStatus = getParisRawStatus(subOrder.status);

      const items = (subOrder.items ?? []).map((item, itemIndex) => {
        const rawItemStatus = getParisRawStatus(item.status);
        const normalizedStatus = normalizeMarketplaceOrderItemStatus(
          MARKETPLACES.PARIS,
          rawItemStatus,
        );

        return {
          marketplaceItemId: getParisMarketplaceItemId(item, itemIndex),
          productTitle: item.name?.trim() || 'Sin titulo',
          // Paris entrega una entidad con id propio por cada unidad comprada.
          productQuantity: 1,
          productPrice: parseParisMoney(item.priceAfterDiscounts),
          status: normalizedStatus,
          marketplaceStatus: rawItemStatus,
          returnId: item.returnId ?? null,
        };
      });

      const normalizedOrderStatus = resolveParisOrderStatus(
        rawOrderStatus,
        items.map((item) => item.status),
      );

      const result = await upsertParisOrder({
        orderId: subOrderNumber,
        shippingAmount: getParisShippingAmount(subOrder),
        status: normalizedOrderStatus,
        documentType,
        deliveryDate: getParisDeliveryDate(subOrder),
        companyRut: invoiceData.companyRut,
        billingCity: invoiceData.billingCity,
        items: items.map(({ returnId: _returnId, ...item }) => item),
      });

      if ('error' in result) {
        throw new Error(
          `No se pudo sincronizar la suborden Paris ${subOrderNumber}: ${result.error}`,
        );
      }

      results.push({ subOrderNumber, ...result });

      if (debug) {
        const diagnostic = {
          subOrderNumber,
          rawOrderStatus,
          normalizedOrderStatus,
          rawOrder: order,
          rawSubOrder: subOrder,
          items: items.map((item) => ({
            marketplaceItemId: item.marketplaceItemId,
            rawItemStatus: item.marketplaceStatus,
            normalizedStatus: item.status,
            hasReturnId: item.returnId != null,
          })),
        };
        diagnostics.push(diagnostic);
        console.info('[Paris][StatusDiagnostic]', JSON.stringify(diagnostic));
      }
    }

    return NextResponse.json({
      mode,
      synchronized: results.length,
      updatedCandidates: recentCandidates.length,
      historicalCandidates: historicalCandidates.length,
      returnCandidates: historicalCandidates.length,
      requestedSubOrderNumber: requestedSubOrderNumber ?? null,
      syncDays: !requestedSubOrderNumber && mode === 'orders' ? syncDays : null,
      returnRecheckDays:
        !requestedSubOrderNumber && mode === 'returns' ? returnRecheckDays : null,
      results,
      ...(debug ? { diagnostics } : {}),
    });
  } catch (error) {
    console.error('Error en la API de Paris:', error);
    return NextResponse.json(
      {
        error: 'Error en la API de Paris',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
