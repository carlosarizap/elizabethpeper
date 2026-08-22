import pool from '@/app/lib/db';
import { createInternalSessionToken } from '../auth/session';
import { MARKETPLACES, type Marketplace } from '../constants/marketplaces';
import {
  marketplacePayloadHasFailures,
  runMarketplaceSync,
} from './marketplace-sync';

export type OrderStatusSnapshot = Map<string, string | null>;

export async function captureOrderStatusSnapshot(
  orderHeaderIds?: string[],
): Promise<OrderStatusSnapshot> {
  const client = await pool.connect();

  try {
    const result = orderHeaderIds
      ? await client.query(
          `SELECT id, status
           FROM order_header
           WHERE id = ANY($1::uuid[])`,
          [orderHeaderIds],
        )
      : await client.query(`SELECT id, status FROM order_header`);
    return new Map(
      result.rows.map((row) => [String(row.id), row.status ?? null]),
    );
  } finally {
    client.release();
  }
}

export async function captureOrderHeaderIds(): Promise<Set<string>> {
  const client = await pool.connect();

  try {
    const result = await client.query(`SELECT id FROM order_header`);
    return new Set(result.rows.map((row) => String(row.id)));
  } finally {
    client.release();
  }
}

export function countChangedOrderStatuses(
  before: OrderStatusSnapshot,
  after: OrderStatusSnapshot,
): number {
  let changedOrders = 0;

  for (const [id, previousStatus] of before) {
    if (after.has(id) && after.get(id) !== previousStatus) changedOrders += 1;
  }

  return changedOrders;
}

export async function refreshMarketplaceStatuses(origin: string, days: number) {
  const before = await captureOrderStatusSnapshot();
  const syncResult = await runMarketplaceSync(origin, 'returns', days);
  const after = await captureOrderStatusSnapshot();

  return {
    ...syncResult,
    changedOrders: countChangedOrderStatuses(before, after),
  };
}

export async function refreshMarketplaceOrders(origin: string) {
  const before = await captureOrderHeaderIds();
  const syncResult = await runMarketplaceSync(origin, 'orders');
  const after = await captureOrderHeaderIds();
  let insertedOrders = 0;

  for (const id of after) {
    if (!before.has(id)) insertedOrders += 1;
  }

  return { ...syncResult, insertedOrders };
}

interface OrderSyncTarget {
  id: string;
  orderId: string;
  marketplace: Marketplace;
}

const TARGET_QUERY_PARAMETERS: Record<Marketplace, string> = {
  [MARKETPLACES.MERCADO_LIBRE]: 'orderId',
  [MARKETPLACES.FALABELLA]: 'orderId',
  [MARKETPLACES.RIPLEY]: 'orderId',
  [MARKETPLACES.PARIS]: 'subOrderNumber',
  [MARKETPLACES.WALMART]: 'purchaseOrderId',
  [MARKETPLACES.SHOPIFY]: 'orderId',
};

const TARGET_ENDPOINTS: Record<Marketplace, string> = {
  [MARKETPLACES.MERCADO_LIBRE]: '/api/mercadolibre/orders',
  [MARKETPLACES.FALABELLA]: '/api/falabella/orders',
  [MARKETPLACES.RIPLEY]: '/api/ripley/orders',
  [MARKETPLACES.PARIS]: '/api/paris/orders',
  [MARKETPLACES.WALMART]: '/api/walmart/orders',
  [MARKETPLACES.SHOPIFY]: '/api/shopify/orders',
};

async function getOrderSyncTargets(orderHeaderIds: string[]): Promise<OrderSyncTarget[]> {
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT id, order_id, marketplace
       FROM order_header
       WHERE id = ANY($1::uuid[])`,
      [orderHeaderIds],
    );

    return result.rows.flatMap((row) => {
      const marketplace = String(row.marketplace) as Marketplace;
      if (!TARGET_ENDPOINTS[marketplace]) return [];

      return [{
        id: String(row.id),
        orderId: String(row.order_id),
        marketplace,
      }];
    });
  } finally {
    client.release();
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}

export async function refreshVisibleOrderStatuses(
  origin: string,
  orderHeaderIds: string[],
) {
  const targets = await getOrderSyncTargets(orderHeaderIds);
  const targetIds = targets.map((target) => target.id);
  const before = await captureOrderStatusSnapshot(targetIds);
  const internalSession = await createInternalSessionToken();

  const results = await mapWithConcurrency(targets, 4, async (target) => {
    const url = new URL(TARGET_ENDPOINTS[target.marketplace], origin);
    url.searchParams.set(
      TARGET_QUERY_PARAMETERS[target.marketplace],
      target.orderId,
    );

    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { 'x-internal-session': internalSession },
      });
      const payload = await response.json().catch(() => null);
      return {
        id: target.id,
        marketplace: target.marketplace,
        ok: response.ok && !marketplacePayloadHasFailures(payload),
        status: response.status,
      };
    } catch (error) {
      return {
        id: target.id,
        marketplace: target.marketplace,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const after = await captureOrderStatusSnapshot(targetIds);

  return {
    mode: 'visible-orders' as const,
    requestedOrders: orderHeaderIds.length,
    checkedOrders: targets.length,
    changedOrders: countChangedOrderStatuses(before, after),
    success: results.every((result) => result.ok),
    results,
  };
}
