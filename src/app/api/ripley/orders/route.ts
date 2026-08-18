import { upsertRipleyOrder } from '@/app/lib/actions/order-actions';
import { MARKETPLACES } from '@/app/lib/constants/marketplaces';
import {
  expandRipleyOrderLineUnits,
  findRipleyFiscalSignals,
  getRipleyDeliveryDate,
  getRipleyShippingAmount,
  hasCompletedRipleyProductRefund,
  resolveRipleyHeaderStatus,
  type RipleyOrder,
} from '@/app/lib/ripley/order-sync';
import { normalizeMarketplaceOrderItemStatus } from '@/app/lib/orders/order-item-status';
import { normalizeOrderStatus } from '@/app/lib/orders/marketplace-status-mappers';
import { NextRequest, NextResponse } from 'next/server';

const RIPLEY_ORDERS_URL = 'https://ripley-prod.mirakl.net/api/orders';

interface RipleyOrdersResponse {
  orders?: RipleyOrder[];
  total_count?: number;
}

function readDays(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isoWithoutMilliseconds(date: Date): string {
  return date.toISOString().split('.')[0];
}

function updateWindow(days: number) {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return {
    start: isoWithoutMilliseconds(start),
    end: isoWithoutMilliseconds(end),
  };
}

async function fetchRipleyOrders(
  apiKey: string,
  filters: Record<string, string>,
): Promise<RipleyOrder[]> {
  const url = new URL(RIPLEY_ORDERS_URL);
  url.searchParams.set('paginate', 'false');
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: apiKey,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Ripley OR11 respondio ${response.status}: ${body.slice(0, 500)}`,
    );
  }

  const payload = (await response.json()) as RipleyOrdersResponse;
  return Array.isArray(payload.orders) ? payload.orders : [];
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.RIPLEY_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Falta API Key de Ripley' }, { status: 400 });
  }

  const requestedOrderId = request.nextUrl.searchParams.get('orderId')?.trim() || undefined;
  const debug = request.nextUrl.searchParams.get('debug') === 'true';
  const syncDays = readDays(process.env.RIPLEY_SYNC_DAYS, 4);
  const returnRecheckDays = readDays(process.env.RIPLEY_RETURN_RECHECK_DAYS, 60);

  try {
    let recentOrders: RipleyOrder[];
    let historicalRefundOrders: RipleyOrder[];

    if (requestedOrderId) {
      recentOrders = await fetchRipleyOrders(apiKey, {
        order_ids: requestedOrderId,
      });
      historicalRefundOrders = [];
    } else {
      const recentWindow = updateWindow(syncDays);
      const returnWindow = updateWindow(returnRecheckDays);
      const responses = await Promise.all([
        fetchRipleyOrders(apiKey, {
          start_update_date: recentWindow.start,
          end_update_date: recentWindow.end,
        }),
        returnRecheckDays > syncDays
          ? fetchRipleyOrders(apiKey, {
              start_update_date: returnWindow.start,
              end_update_date: returnWindow.end,
            })
          : Promise.resolve([]),
      ]);
      recentOrders = responses[0];
      historicalRefundOrders = responses[1].filter(
        hasCompletedRipleyProductRefund,
      );
    }

    const candidates = new Map<string, RipleyOrder>();
    for (const order of [...recentOrders, ...historicalRefundOrders]) {
      const orderId = order.order_id?.trim();
      if (orderId) candidates.set(orderId, order);
    }

    const results = [];
    const diagnostics = [];
    let partialQuantityRefunds = 0;

    for (const [orderId, order] of candidates) {
      const rawOrderStatus = order.order_state?.trim() || null;
      const normalizedRawOrderStatus = normalizeOrderStatus(
        MARKETPLACES.RIPLEY,
        rawOrderStatus,
      );
      const fiscalSignals = findRipleyFiscalSignals(order);
      if (fiscalSignals.length > 0) {
        console.warn(
          `[Ripley][Fiscal] La orden ${orderId} expone campos para revision: ${fiscalSignals.join(', ')}`,
        );
      }

      const items = (order.order_lines ?? []).flatMap((line, lineIndex) => {
        const rawLineStatus = line.order_line_state?.trim() || null;
        const normalizedRawLineStatus = normalizeMarketplaceOrderItemStatus(
          MARKETPLACES.RIPLEY,
          rawLineStatus,
        );
        const expansion = expandRipleyOrderLineUnits(
          line,
          lineIndex,
          normalizedRawLineStatus,
          normalizedRawOrderStatus,
        );

        if (
          expansion.refund.classification === 'partial_quantity' ||
          expansion.refund.classification === 'indeterminate'
        ) {
          partialQuantityRefunds += 1;
        }

        if (expansion.warning) {
          console.warn(
            `[Ripley][RefundQuantity] La linea ${line.order_line_id ?? lineIndex} de la orden ${orderId} no se pudo dividir con seguridad: ${expansion.warning}.`,
          );
        }

        return expansion.items.map((item) => ({
          ...item,
          productTitle: line.product_title?.trim() || 'Sin titulo',
          marketplaceStatus: rawLineStatus,
          refund: expansion.refund,
        }));
      });

      const normalizedOrderStatus = resolveRipleyHeaderStatus(
        normalizedRawOrderStatus,
        items.map((item) => item.status),
      );

      const result = await upsertRipleyOrder({
        orderId,
        shippingAmount: getRipleyShippingAmount(order),
        status: normalizedOrderStatus,
        deliveryDate: getRipleyDeliveryDate(order),
        items: items.map(({ refund: _refund, ...item }) => item),
      });

      if ('error' in result) {
        throw new Error(
          `No se pudo sincronizar la orden Ripley ${orderId}: ${result.error}`,
        );
      }

      results.push({ orderId, ...result });

      if (debug) {
        const diagnostic = {
          orderId,
          rawOrderStatus,
          normalizedOrderStatus,
          fiscalSignals,
          rawOrder: order,
          items: items.map((item) => ({
            marketplaceItemId: item.marketplaceItemId,
            rawStatus: item.marketplaceStatus,
            normalizedStatus: item.status,
            refund: item.refund,
          })),
        };
        diagnostics.push(diagnostic);
        console.info('[Ripley][StatusDiagnostic]', JSON.stringify(diagnostic));
      }
    }

    return NextResponse.json({
      synchronized: results.length,
      updatedCandidates: recentOrders.length,
      returnCandidates: historicalRefundOrders.length,
      requestedOrderId: requestedOrderId ?? null,
      syncDays: requestedOrderId ? null : syncDays,
      returnRecheckDays: requestedOrderId ? null : returnRecheckDays,
      partialQuantityRefunds,
      results,
      ...(debug ? { diagnostics } : {}),
    });
  } catch (error) {
    console.error('Error en la API de Ripley:', error);
    return NextResponse.json(
      {
        error: 'Error en la API de Ripley',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
