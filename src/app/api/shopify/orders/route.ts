import { upsertShopifyOrder } from '@/app/lib/actions/order-actions';
import {
  buildShopifyUpdatedAtSearch,
  collectShopifyCursorPages,
  normalizeShopifyOrder,
  SHOPIFY_ADMIN_API_VERSION,
  toShopifyOrderGid,
  type ShopifyOrder,
} from '@/app/lib/shopify/order-sync';
import {
  getShopifyAccessToken,
  getShopifyGrantedScopes,
} from '@/app/lib/shopify/token-manager';
import { getMarketplaceSyncMode } from '@/app/lib/orders/marketplace-sync';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ORDERS_PAGE_SIZE = 100;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function getShopifyGraphqlUrl(): string {
  const shop = process.env.SHOPIFY_SHOP;
  if (!shop) throw new Error('Falta SHOPIFY_SHOP');
  return `https://${shop}.myshopify.com/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;
}

async function shopifyGraphQL<T>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(getShopifyGraphqlUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Error Shopify GraphQL ${response.status}: ${JSON.stringify(data)}`);
  }
  if (data?.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }
  return data.data as T;
}

const ORDER_CORE_FIELDS = `
  id
  name
  createdAt
  updatedAt
  cancelledAt
  cancellation { staffNote }
  displayFulfillmentStatus
  totalShippingPriceSet { shopMoney { amount currencyCode } }
  currentShippingPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 250) {
    nodes {
      id
      title
      name
      sku
      quantity
      currentQuantity
      unfulfilledQuantity
      refundableQuantity
      discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount currencyCode } }
      discountedTotalSet(withCodeDiscounts: true) { shopMoney { amount currencyCode } }
      originalTotalSet { shopMoney { amount currencyCode } }
      totalDiscountSet { shopMoney { amount currencyCode } }
    }
  }
  fulfillments(first: 100) {
    id
    status
    displayStatus
    createdAt
    updatedAt
    deliveredAt
    inTransitAt
    estimatedDeliveryAt
    fulfillmentLineItems(first: 250) {
      nodes { quantity lineItem { id } }
    }
    events(first: 100) {
      nodes { status happenedAt estimatedDeliveryAt }
    }
  }
`;

function refundFields(includeReturns: boolean): string {
  return `
  refunds(first: 100) {
    id
    createdAt
    updatedAt
    ${includeReturns ? 'return { id status }' : ''}
    refundLineItems(first: 250) {
      nodes { id quantity restockType lineItem { id } }
    }
  }
`;
}

const RETURNS_FIELDS = `
  returns(first: 100) {
    nodes {
      id
      status
      createdAt
      closedAt
      returnLineItems(first: 250) {
        nodes {
          __typename
          ... on ReturnLineItem {
            id
            quantity
            processedQuantity
            refundedQuantity
            processableQuantity
            unprocessedQuantity
            fulfillmentLineItem { id lineItem { id } }
          }
        }
      }
    }
  }
`;

function orderDetailQuery(includeReturns: boolean): string {
  return `
    query ShopifyOrder($id: ID!) {
      order(id: $id) {
        ${ORDER_CORE_FIELDS}
        ${refundFields(includeReturns)}
        ${includeReturns ? RETURNS_FIELDS : ''}
      }
    }
  `;
}

async function fetchOrderGidsForPeriod(accessToken: string, days: number) {
  const query = `
    query ShopifyUpdatedOrders($query: String!, $cursor: String) {
      orders(
        first: ${ORDERS_PAGE_SIZE},
        after: $cursor,
        query: $query,
        sortKey: UPDATED_AT,
        reverse: false
      ) {
        nodes { id }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
  const search = buildShopifyUpdatedAtSearch(days);
  const paginated = await collectShopifyCursorPages(async (cursor) => {
    const data: {
      orders?: {
        nodes?: Array<{ id?: string | null }>;
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      };
    } = await shopifyGraphQL(accessToken, query, { query: search, cursor });
    const pageInfo = data.orders?.pageInfo;
    return {
      nodes: (data.orders?.nodes ?? [])
        .map((order) => order.id?.trim() ?? '')
        .filter(Boolean),
      hasNextPage: Boolean(pageInfo?.hasNextPage),
      endCursor: pageInfo?.endCursor ?? null,
    };
  });
  return {
    ids: Array.from(new Set(paginated.nodes)),
    pages: paginated.pages,
    search,
  };
}

async function resolveDirectedOrderGid(
  accessToken: string,
  requestedOrderId: string,
): Promise<string | null> {
  const directGid = toShopifyOrderGid(requestedOrderId);
  if (directGid) return directGid;
  const query = `
    query FindShopifyOrder($query: String!) {
      orders(first: 10, query: $query) { nodes { id name } }
    }
  `;
  const data = await shopifyGraphQL<{
    orders?: { nodes?: Array<{ id?: string | null; name?: string | null }> };
  }>(accessToken, query, { query: `name:${requestedOrderId}` });
  const exact = (data.orders?.nodes ?? []).find(
    (order) => order.name === requestedOrderId,
  );
  return exact?.id?.trim() || data.orders?.nodes?.[0]?.id?.trim() || null;
}

async function fetchShopifyOrder(
  accessToken: string,
  gid: string,
  includeReturns: boolean,
): Promise<ShopifyOrder | null> {
  const data = await shopifyGraphQL<{ order?: ShopifyOrder | null }>(
    accessToken,
    orderDetailQuery(includeReturns),
    { id: gid },
  );
  return data.order ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const requestedOrderId = request.nextUrl.searchParams.get('orderId')?.trim() || null;
    const mode = getMarketplaceSyncMode(request.nextUrl.searchParams);
    const syncDays = positiveInteger(process.env.SHOPIFY_SYNC_DAYS, 4);
    const returnRecheckDays = positiveInteger(
      process.env.SHOPIFY_RETURN_RECHECK_DAYS,
      60,
    );
    const accessToken = await getShopifyAccessToken();
    const scopes = await getShopifyGrantedScopes(accessToken);
    if (!scopes.has('read_orders') && !scopes.has('write_orders')) {
      throw new Error('La app Shopify no tiene read_orders ni write_orders');
    }

    const returnsRequested = mode === 'returns' || Boolean(requestedOrderId);
    const includeReturns = returnsRequested && scopes.has('read_returns');
    if (returnsRequested && !includeReturns) {
      console.warn(
        '[Shopify][Returns] Falta el scope read_returns; se sincronizaran ordenes, fulfillments y refunds sin marcar devoluciones fisicas.',
      );
    }
    if (!scopes.has('read_all_orders')) {
      console.warn(
        '[Shopify][Orders] Falta read_all_orders; Shopify limita por defecto el acceso a ordenes creadas en los ultimos 60 dias.',
      );
    }

    let orderGids: string[];
    let pages = 1;
    let search: string | null = null;
    if (requestedOrderId) {
      const gid = await resolveDirectedOrderGid(accessToken, requestedOrderId);
      if (!gid) {
        return NextResponse.json(
          { error: `No se encontró la orden Shopify ${requestedOrderId}` },
          { status: 404 },
        );
      }
      orderGids = [gid];
    } else {
      const period = await fetchOrderGidsForPeriod(
        accessToken,
        mode === 'returns' ? returnRecheckDays : syncDays,
      );
      orderGids = period.ids;
      pages = period.pages;
      search = period.search;
    }

    const results = [];
    for (const gid of orderGids) {
      try {
        const rawOrder = await fetchShopifyOrder(accessToken, gid, includeReturns);
        if (!rawOrder) {
          results.push({ success: false, gid, error: 'Orden no accesible o inexistente' });
          continue;
        }
        const normalized = normalizeShopifyOrder(rawOrder);
        const result = await upsertShopifyOrder(normalized);
        results.push({ ...result, orderId: normalized.orderId });
      } catch (error) {
        console.error(`[Shopify] Error al sincronizar ${gid}:`, error);
        results.push({
          success: false,
          gid,
          error: error instanceof Error ? error.message : 'Error desconocido',
        });
      }
    }

    return NextResponse.json({
      mode,
      synchronized: results.filter((result) => 'success' in result && result.success).length,
      candidates: orderGids.length,
      requestedOrderId,
      syncDays: !requestedOrderId && mode === 'orders' ? syncDays : null,
      returnRecheckDays:
        !requestedOrderId && mode === 'returns' ? returnRecheckDays : null,
      apiVersion: SHOPIFY_ADMIN_API_VERSION,
      pagination: { pages, search },
      returns: {
        status: !returnsRequested
          ? 'not_requested'
          : includeReturns ? 'enabled' : 'disabled_missing_scope',
        requiredScope: 'read_returns',
      },
      oldOrders: {
        status: scopes.has('read_all_orders') ? 'enabled' : 'limited_to_60_days',
        optionalScope: 'read_all_orders',
      },
      results,
    });
  } catch (error) {
    console.error('Error en la API de Shopify:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error en la API de Shopify' },
      { status: 500 },
    );
  }
}
