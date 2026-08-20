import { MARKETPLACES } from '../constants/marketplaces.ts';
import {
  normalizeMarketplaceOrderItemStatus,
  STANDARD_ORDER_ITEM_STATUSES,
  type StandardOrderItemStatus,
} from '../orders/order-item-status.ts';
import {
  isStandardOrderStatus,
  isValidOrderStatusTransition,
  ORDER_STATUSES,
  type StandardOrderStatus,
} from '../orders/order-status.ts';
import { normalizeOrderStatus } from '../orders/marketplace-status-mappers.ts';

export const SHOPIFY_ADMIN_API_VERSION = '2026-01';

interface ShopifyMoneyBag {
  shopMoney?: { amount?: string | null } | null;
}

export interface ShopifyLineItem {
  id?: string | null;
  title?: string | null;
  name?: string | null;
  sku?: string | null;
  quantity?: number | null;
  currentQuantity?: number | null;
  unfulfilledQuantity?: number | null;
  refundableQuantity?: number | null;
  discountedUnitPriceAfterAllDiscountsSet?: ShopifyMoneyBag | null;
  discountedTotalSet?: ShopifyMoneyBag | null;
  originalTotalSet?: ShopifyMoneyBag | null;
  totalDiscountSet?: ShopifyMoneyBag | null;
}

export interface ShopifyFulfillment {
  id?: string | null;
  status?: string | null;
  displayStatus?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  deliveredAt?: string | null;
  inTransitAt?: string | null;
  estimatedDeliveryAt?: string | null;
  fulfillmentLineItems?: {
    nodes?: Array<{
      quantity?: number | null;
      lineItem?: { id?: string | null } | null;
    }> | null;
  } | null;
  events?: {
    nodes?: Array<{
      status?: string | null;
      happenedAt?: string | null;
      estimatedDeliveryAt?: string | null;
    }> | null;
  } | null;
}

export interface ShopifyReturnLineItem {
  __typename?: string | null;
  id?: string | null;
  quantity?: number | null;
  processedQuantity?: number | null;
  refundedQuantity?: number | null;
  processableQuantity?: number | null;
  unprocessedQuantity?: number | null;
  fulfillmentLineItem?: {
    id?: string | null;
    lineItem?: { id?: string | null } | null;
  } | null;
}

export interface ShopifyReturn {
  id?: string | null;
  status?: string | null;
  createdAt?: string | null;
  closedAt?: string | null;
  returnLineItems?: { nodes?: ShopifyReturnLineItem[] | null } | null;
}

export interface ShopifyRefund {
  id?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  return?: { id?: string | null; status?: string | null } | null;
  refundLineItems?: {
    nodes?: Array<{
      quantity?: number | null;
      restockType?: string | null;
      lineItem?: { id?: string | null } | null;
    }> | null;
  } | null;
}

export interface ShopifyOrder {
  id?: string | null;
  name?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  cancelledAt?: string | null;
  displayFulfillmentStatus?: string | null;
  totalShippingPriceSet?: ShopifyMoneyBag | null;
  currentShippingPriceSet?: ShopifyMoneyBag | null;
  lineItems?: { nodes?: ShopifyLineItem[] | null } | null;
  fulfillments?: ShopifyFulfillment[] | null;
  returns?: { nodes?: ShopifyReturn[] | null } | null;
  refunds?: ShopifyRefund[] | null;
}

export interface ShopifyExpandedItem {
  marketplaceItemId: string;
  productTitle: string;
  productQuantity: number;
  productPrice: number;
  status: StandardOrderItemStatus;
  marketplaceStatus: string | null;
}

export interface NormalizedShopifyOrder {
  orderId: string;
  shippingAmount: number;
  status: StandardOrderStatus;
  deliveryDate: string | null;
  items: ShopifyExpandedItem[];
}

export function buildShopifyUpdatedAtSearch(
  days: number,
  now = new Date(),
): string {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.trunc(days) : 4;
  const minimum = new Date(now);
  minimum.setUTCDate(minimum.getUTCDate() - safeDays);
  return `updated_at:>=${minimum.toISOString()}`;
}

export async function collectShopifyCursorPages<T>(
  fetchPage: (cursor: string | null) => Promise<{
    nodes: readonly T[];
    hasNextPage: boolean;
    endCursor: string | null;
  }>,
): Promise<{ nodes: T[]; pages: number }> {
  const nodes: T[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await fetchPage(cursor);
    nodes.push(...page.nodes);
    pages += 1;
    if (page.hasNextPage && !page.endCursor) {
      throw new Error('Shopify indicó otra página pero no entregó endCursor');
    }
    cursor = page.hasNextPage ? page.endCursor : null;
  } while (cursor);
  return { nodes, pages };
}

function asPositiveInteger(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
}

function moneyAmount(value: ShopifyMoneyBag | null | undefined): number {
  const parsed = Number(value?.shopMoney?.amount ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toShopifyOrderId(
  shopifyGid?: string | null,
  orderName?: string | null,
): string {
  const numericId = shopifyGid?.split('/').pop()?.trim() ?? '';
  if (orderName?.trim() && numericId) return `${orderName.trim()}-${numericId}`;
  return numericId || orderName?.trim() || '';
}

export function toShopifyOrderGid(orderId: string): string | null {
  const trimmed = orderId.trim();
  if (trimmed.startsWith('gid://shopify/Order/')) return trimmed;
  const numericId = trimmed.includes('-') ? trimmed.split('-').pop() : trimmed;
  return numericId && /^\d+$/.test(numericId)
    ? `gid://shopify/Order/${numericId}`
    : null;
}

export function getShopifyMarketplaceItemId(
  lineItemId: string,
  unitIndex = 0,
): string {
  return unitIndex === 0 ? lineItemId : `${lineItemId}:unit:${unitIndex + 1}`;
}

export function getShopifyUnitPrice(line: ShopifyLineItem): number {
  const discountedUnit = moneyAmount(
    line.discountedUnitPriceAfterAllDiscountsSet,
  );
  if (discountedUnit >= 0 && line.discountedUnitPriceAfterAllDiscountsSet) {
    return discountedUnit;
  }

  const quantity = Math.max(1, asPositiveInteger(line.quantity, 1));
  const discountedTotal = moneyAmount(line.discountedTotalSet);
  if (discountedTotal >= 0 && line.discountedTotalSet) {
    return discountedTotal / quantity;
  }

  const originalTotal = moneyAmount(line.originalTotalSet);
  const totalDiscount = moneyAmount(line.totalDiscountSet);
  return Math.max(0, originalTotal - totalDiscount) / quantity;
}

export function getShopifyShippingAmount(order: ShopifyOrder): number {
  // totalShippingPriceSet conserva el despacho original; currentShippingPriceSet
  // puede disminuir después de un reembolso y no debe reescribir la boleta.
  return Math.max(0, moneyAmount(order.totalShippingPriceSet));
}

function chileDateParts(value: string): { year: number; month: number; day: number } | null {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return year && month && day ? { year, month, day } : null;
}

export function toSantiagoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = chileDateParts(value);
  if (!parts) return null;
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function calculateShopifyFallbackDeliveryDate(
  createdAt: string | null | undefined,
): string | null {
  if (!createdAt) return null;
  const parts = chileDateParts(createdAt);
  if (!parts) return null;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  date.setUTCDate(date.getUTCDate() + 1);
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 2);
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  return values.reduce<string | null>((latest, value) => {
    if (!value || !Number.isFinite(Date.parse(value))) return latest;
    if (!latest || Date.parse(value) > Date.parse(latest)) return value;
    return latest;
  }, null);
}

export function getShopifyDeliveryDate(order: ShopifyOrder): string | null {
  const fulfillments = order.fulfillments ?? [];
  const delivered = latestTimestamp([
    ...fulfillments.map((fulfillment) => fulfillment.deliveredAt),
    ...fulfillments.flatMap((fulfillment) =>
      (fulfillment.events?.nodes ?? [])
        .filter((event) => event.status?.toUpperCase() === 'DELIVERED')
        .map((event) => event.happenedAt),
    ),
  ]);
  if (delivered) return toSantiagoDate(delivered);

  const estimated = latestTimestamp([
    ...fulfillments.map((fulfillment) => fulfillment.estimatedDeliveryAt),
    ...fulfillments.flatMap((fulfillment) =>
      (fulfillment.events?.nodes ?? []).map((event) => event.estimatedDeliveryAt),
    ),
  ]);
  return estimated
    ? toSantiagoDate(estimated)
    : calculateShopifyFallbackDeliveryDate(order.createdAt);
}

function fulfillmentStatus(fulfillment: ShopifyFulfillment): StandardOrderItemStatus | null {
  const events = fulfillment.events?.nodes ?? [];
  const delivered = Boolean(fulfillment.deliveredAt) || events.some(
    (event) => event.status?.toUpperCase() === 'DELIVERED',
  );
  if (delivered) return STANDARD_ORDER_ITEM_STATUSES.DELIVERED;

  const rawStatus = fulfillment.status?.toUpperCase();
  if (rawStatus === 'SUCCESS') return STANDARD_ORDER_ITEM_STATUSES.SHIPPED;
  return null;
}

interface ReturnSummary {
  processedQuantity: number;
  relatedQuantity: number;
  latestStatus: string | null;
  latestTime: number;
}

export function collectShopifyReturnSummaries(
  returns: readonly ShopifyReturn[],
): Map<string, ReturnSummary> {
  const summaries = new Map<string, ReturnSummary>();
  for (const shopifyReturn of returns) {
    const status = shopifyReturn.status?.toUpperCase() ?? 'UNKNOWN';
    const timestamp = Date.parse(shopifyReturn.closedAt ?? shopifyReturn.createdAt ?? '');
    for (const item of shopifyReturn.returnLineItems?.nodes ?? []) {
      if (item.__typename && item.__typename !== 'ReturnLineItem') continue;
      const lineItemId = item.fulfillmentLineItem?.lineItem?.id?.trim();
      if (!lineItemId) continue;
      const current = summaries.get(lineItemId) ?? {
        processedQuantity: 0,
        relatedQuantity: 0,
        latestStatus: null,
        latestTime: Number.NEGATIVE_INFINITY,
      };
      current.relatedQuantity += asPositiveInteger(item.quantity);
      if (status === 'CLOSED') {
        current.processedQuantity += asPositiveInteger(item.processedQuantity);
      }
      const comparableTime = Number.isFinite(timestamp) ? timestamp : 0;
      if (comparableTime >= current.latestTime) {
        current.latestStatus = status;
        current.latestTime = comparableTime;
      }
      summaries.set(lineItemId, current);
    }
  }
  return summaries;
}

function refundLinesFor(
  refunds: readonly ShopifyRefund[],
  lineItemId: string,
): Array<{ quantity: number; restockType: string; linkedReturn: boolean }> {
  return refunds.flatMap((refund) =>
    (refund.refundLineItems?.nodes ?? [])
      .filter((item) => item.lineItem?.id === lineItemId)
      .map((item) => ({
        quantity: asPositiveInteger(item.quantity),
        restockType: item.restockType?.toUpperCase() ?? 'UNKNOWN',
        linkedReturn: Boolean(refund.return?.id),
      })),
  );
}

export function expandShopifyLineItemUnits(
  order: ShopifyOrder,
  line: ShopifyLineItem,
  lineIndex: number,
  returnSummaries = collectShopifyReturnSummaries(order.returns?.nodes ?? []),
): ShopifyExpandedItem[] {
  const lineItemId = line.id?.trim() || `shopify-line:${lineIndex + 1}`;
  const quantity = Math.max(1, asPositiveInteger(line.quantity, 1));
  const statuses = Array<StandardOrderItemStatus>(quantity).fill(
    STANDARD_ORDER_ITEM_STATUSES.PENDING,
  );
  const rawStatuses = Array<string | null>(quantity).fill(
    order.displayFulfillmentStatus ?? null,
  );

  let nextFulfilledIndex = 0;
  const matchingFulfillments = (order.fulfillments ?? [])
    .flatMap((fulfillment) => {
      const status = fulfillmentStatus(fulfillment);
      if (!status) return [];
      return (fulfillment.fulfillmentLineItems?.nodes ?? [])
        .filter((item) => item.lineItem?.id === lineItemId)
        .map((item) => ({
          quantity: asPositiveInteger(item.quantity),
          status,
          rawStatus:
            status === STANDARD_ORDER_ITEM_STATUSES.DELIVERED
              ? 'DELIVERED'
              : fulfillment.displayStatus ?? fulfillment.status ?? 'SUCCESS',
        }));
    })
    .sort((left, right) =>
      left.status === STANDARD_ORDER_ITEM_STATUSES.DELIVERED &&
      right.status !== STANDARD_ORDER_ITEM_STATUSES.DELIVERED
        ? -1
        : 0,
    );

  for (const fulfillment of matchingFulfillments) {
    for (let count = 0; count < fulfillment.quantity && nextFulfilledIndex < quantity; count += 1) {
      statuses[nextFulfilledIndex] = fulfillment.status;
      rawStatuses[nextFulfilledIndex] = fulfillment.rawStatus;
      nextFulfilledIndex += 1;
    }
  }

  const refundLines = refundLinesFor(order.refunds ?? [], lineItemId);
  let cancelQuantity = refundLines
    .filter((refund) => !refund.linkedReturn && refund.restockType === 'CANCEL')
    .reduce((sum, refund) => sum + refund.quantity, 0);
  // currentQuantity excluye unidades reembolsadas o removidas. Solo se aplican
  // como canceladas sobre unidades aún pendientes; una unidad ya entregada no
  // se convierte en devolución física por este dato financiero.
  cancelQuantity = Math.max(
    cancelQuantity,
    quantity - asPositiveInteger(line.currentQuantity, quantity),
  );
  if (order.cancelledAt || order.displayFulfillmentStatus?.toUpperCase() === 'RESTOCKED') {
    cancelQuantity = Math.max(cancelQuantity, quantity - nextFulfilledIndex);
  }
  for (let index = quantity - 1; index >= 0 && cancelQuantity > 0; index -= 1) {
    if (statuses[index] === STANDARD_ORDER_ITEM_STATUSES.PENDING) {
      statuses[index] = STANDARD_ORDER_ITEM_STATUSES.CANCELED;
      rawStatuses[index] = order.cancelledAt ? 'CANCELLED' : 'REFUND_CANCEL';
      cancelQuantity -= 1;
    }
  }

  const returnSummary = returnSummaries.get(lineItemId);
  let returnedQuantity = Math.min(
    quantity,
    asPositiveInteger(returnSummary?.processedQuantity),
  );
  const returnCandidates = statuses
    .map((status, index) => ({ status, index }))
    .filter(({ status }) => status !== STANDARD_ORDER_ITEM_STATUSES.CANCELED)
    .sort((left, right) => {
      const priority: Record<StandardOrderItemStatus, number> = {
        [STANDARD_ORDER_ITEM_STATUSES.DELIVERED]: 0,
        [STANDARD_ORDER_ITEM_STATUSES.SHIPPED]: 1,
        [STANDARD_ORDER_ITEM_STATUSES.PENDING]: 2,
        [STANDARD_ORDER_ITEM_STATUSES.RETURNED]: 3,
        [STANDARD_ORDER_ITEM_STATUSES.CANCELED]: 4,
      };
      return priority[left.status] - priority[right.status];
    });
  for (const candidate of returnCandidates) {
    if (returnedQuantity <= 0) break;
    statuses[candidate.index] = STANDARD_ORDER_ITEM_STATUSES.RETURNED;
    rawStatuses[candidate.index] = 'RETURN_CLOSED';
    returnedQuantity -= 1;
  }

  if ((returnSummary?.processedQuantity ?? 0) > quantity) {
    console.warn(
      `[Shopify][ReturnQuantity] ${lineItemId} informa ${returnSummary?.processedQuantity} unidades procesadas para una compra de ${quantity}.`,
    );
  }

  if (returnSummary?.latestStatus && returnSummary.latestStatus !== 'CLOSED') {
    let related = Math.min(quantity, returnSummary.relatedQuantity);
    for (let index = 0; index < quantity && related > 0; index += 1) {
      if (
        statuses[index] !== STANDARD_ORDER_ITEM_STATUSES.CANCELED &&
        statuses[index] !== STANDARD_ORDER_ITEM_STATUSES.RETURNED
      ) {
        rawStatuses[index] = `RETURN_${returnSummary.latestStatus}`;
        related -= 1;
      }
    }
  }

  const unlinkedRefund = refundLines.find(
    (refund) => !refund.linkedReturn && refund.restockType !== 'CANCEL',
  );
  if (unlinkedRefund) {
    let affected = Math.min(quantity, unlinkedRefund.quantity);
    for (let index = 0; index < quantity && affected > 0; index += 1) {
      if (statuses[index] !== STANDARD_ORDER_ITEM_STATUSES.RETURNED) {
        rawStatuses[index] = `REFUND_${unlinkedRefund.restockType}_UNLINKED`;
        affected -= 1;
      }
    }
  }

  const productTitle = line.title?.trim() || line.name?.trim() || line.sku?.trim() || 'Sin titulo';
  const productPrice = getShopifyUnitPrice(line);
  return statuses.map((status, unitIndex) => ({
    marketplaceItemId: getShopifyMarketplaceItemId(lineItemId, unitIndex),
    productTitle,
    productQuantity: 1,
    productPrice,
    status,
    marketplaceStatus: rawStatuses[unitIndex],
  }));
}

export function resolveShopifyOrderStatus(
  itemStatuses: readonly StandardOrderItemStatus[],
  displayFulfillmentStatus?: string | null,
  cancelledAt?: string | null,
): StandardOrderStatus {
  if (itemStatuses.length === 0) {
    if (cancelledAt) return ORDER_STATUSES.CANCELED;
    return normalizeOrderStatus(MARKETPLACES.SHOPIFY, displayFulfillmentStatus);
  }
  if (itemStatuses.every((status) => status === STANDARD_ORDER_ITEM_STATUSES.RETURNED)) {
    return ORDER_STATUSES.RETURNED;
  }
  if (itemStatuses.every((status) => status === STANDARD_ORDER_ITEM_STATUSES.CANCELED)) {
    return ORDER_STATUSES.CANCELED;
  }
  const active = itemStatuses.filter(
    (status) =>
      status !== STANDARD_ORDER_ITEM_STATUSES.RETURNED &&
      status !== STANDARD_ORDER_ITEM_STATUSES.CANCELED,
  );
  if (active.includes(STANDARD_ORDER_ITEM_STATUSES.DELIVERED)) return ORDER_STATUSES.DELIVERED;
  if (active.includes(STANDARD_ORDER_ITEM_STATUSES.SHIPPED)) return ORDER_STATUSES.SHIPPED;
  if (active.includes(STANDARD_ORDER_ITEM_STATUSES.PENDING)) return ORDER_STATUSES.PENDING;
  return itemStatuses.includes(STANDARD_ORDER_ITEM_STATUSES.RETURNED)
    ? ORDER_STATUSES.DELIVERED
    : ORDER_STATUSES.CANCELED;
}

export function normalizeShopifyOrder(order: ShopifyOrder): NormalizedShopifyOrder {
  const orderId = toShopifyOrderId(order.id, order.name);
  if (!orderId) throw new Error('La orden Shopify no tiene id ni name');
  const returnSummaries = collectShopifyReturnSummaries(order.returns?.nodes ?? []);
  const items = (order.lineItems?.nodes ?? []).flatMap((line, index) =>
    expandShopifyLineItemUnits(order, line, index, returnSummaries),
  );
  return {
    orderId,
    shippingAmount: getShopifyShippingAmount(order),
    status: resolveShopifyOrderStatus(
      items.map((item) => item.status),
      order.displayFulfillmentStatus,
      order.cancelledAt,
    ),
    deliveryDate: getShopifyDeliveryDate(order),
    items,
  };
}

export function resolveShopifyExistingHeaderStatus(
  currentStatus: string,
  incomingStatus: StandardOrderStatus,
) {
  const accepted =
    !isStandardOrderStatus(currentStatus) ||
    isValidOrderStatusTransition(currentStatus, incomingStatus);
  return { status: accepted ? incomingStatus : currentStatus, accepted };
}

export function normalizeShopifyItemRawStatus(rawStatus: unknown) {
  return normalizeMarketplaceOrderItemStatus(MARKETPLACES.SHOPIFY, rawStatus);
}
