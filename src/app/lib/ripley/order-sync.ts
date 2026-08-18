import {
  cleanNullableString,
} from '../falabella/invoice-data.ts';
import {
  isStandardOrderStatus,
  isValidOrderStatusTransition,
  ORDER_STATUSES,
  type StandardOrderStatus,
} from '../orders/order-status.ts';

export interface RipleyAdditionalField {
  code?: string | null;
  value?: unknown;
}

export interface RipleyRefund {
  id?: string | number | null;
  quantity?: string | number | null;
  amount?: string | number | null;
  shipping_amount?: string | number | null;
  created_date?: string | null;
  reason_code?: string | null;
  refund_state?: string | null;
  state?: string | null;
}

export interface RipleyOrderLine {
  order_line_id?: string | null;
  offer_sku?: string | null;
  product_sku?: string | null;
  product_shop_sku?: string | null;
  product_title?: string | null;
  quantity?: string | number | null;
  price?: string | number | null;
  order_line_state?: string | null;
  shipped_date?: string | null;
  received_date?: string | null;
  refunds?: RipleyRefund[] | null;
  cancelations?: unknown[] | null;
}

export interface RipleyOrder {
  order_id?: string | null;
  order_state?: string | null;
  created_date?: string | null;
  last_updated_date?: string | null;
  delivery_date?: string | null;
  shipping_deadline?: string | null;
  shipping_price?: string | number | null;
  order_additional_fields?: RipleyAdditionalField[] | null;
  order_lines?: RipleyOrderLine[] | null;
  [key: string]: unknown;
}

export type RipleyRefundClassification =
  | 'none'
  | 'canceled_before_delivery'
  | 'returned_after_delivery'
  | 'partial_quantity'
  | 'indeterminate';

export interface RipleyRefundAnalysis {
  classification: RipleyRefundClassification;
  purchasedQuantity: number;
  refundedQuantity: number;
  returnedQuantity: number;
  canceledQuantity: number;
  completedProductRefunds: number;
}

export interface RipleyExpandedOrderItem {
  marketplaceItemId: string;
  productQuantity: number;
  productPrice: number;
  status: StandardOrderStatus;
}

export interface RipleyLineExpansion {
  items: RipleyExpandedOrderItem[];
  refund: RipleyRefundAnalysis;
  warning: string | null;
}

export function parseRipleyNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedRefundState(refund: RipleyRefund): string {
  return String(refund.refund_state ?? refund.state ?? '').trim().toUpperCase();
}

function validTimestamp(value: unknown): number | null {
  const cleaned = cleanNullableString(value);
  if (!cleaned) return null;
  const timestamp = Date.parse(cleaned);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function analyzeRipleyLineRefund(
  line: RipleyOrderLine,
): RipleyRefundAnalysis {
  const purchasedQuantity = Math.max(0, parseRipleyNumber(line.quantity));
  const completedProductRefunds = (line.refunds ?? []).filter(
    (refund) =>
      normalizedRefundState(refund) === 'REFUNDED' &&
      parseRipleyNumber(refund.amount) > 0,
  );
  const refundedQuantity = completedProductRefunds.reduce(
    (total, refund) => total + Math.max(0, parseRipleyNumber(refund.quantity)),
    0,
  );
  const receivedAt = validTimestamp(line.received_date);
  const returnedQuantity = completedProductRefunds.reduce((total, refund) => {
    const refundAt = validTimestamp(refund.created_date);
    return receivedAt !== null && refundAt !== null && refundAt >= receivedAt
      ? total + Math.max(0, parseRipleyNumber(refund.quantity))
      : total;
  }, 0);
  const canceledQuantity = Math.max(0, refundedQuantity - returnedQuantity);

  if (completedProductRefunds.length === 0) {
    return {
      classification: 'none',
      purchasedQuantity,
      refundedQuantity: 0,
      returnedQuantity: 0,
      canceledQuantity: 0,
      completedProductRefunds: 0,
    };
  }

  if (purchasedQuantity <= 0 || refundedQuantity <= 0) {
    return {
      classification: 'indeterminate',
      purchasedQuantity,
      refundedQuantity,
      returnedQuantity,
      canceledQuantity,
      completedProductRefunds: completedProductRefunds.length,
    };
  }

  if (refundedQuantity < purchasedQuantity) {
    return {
      classification: 'partial_quantity',
      purchasedQuantity,
      refundedQuantity,
      returnedQuantity,
      canceledQuantity,
      completedProductRefunds: completedProductRefunds.length,
    };
  }

  const allRefundsAfterDelivery = returnedQuantity >= purchasedQuantity;
  const allRefundsBeforeDelivery = canceledQuantity >= purchasedQuantity;

  return {
    classification: allRefundsAfterDelivery
      ? 'returned_after_delivery'
      : allRefundsBeforeDelivery
        ? 'canceled_before_delivery'
        : 'partial_quantity',
    purchasedQuantity,
    refundedQuantity,
    returnedQuantity,
    canceledQuantity,
    completedProductRefunds: completedProductRefunds.length,
  };
}

function resolveRipleyLogisticsStatus(
  line: RipleyOrderLine,
  rawLineStatus: StandardOrderStatus,
  rawOrderStatus: StandardOrderStatus,
): StandardOrderStatus {
  if (validTimestamp(line.received_date) !== null) {
    return ORDER_STATUSES.DELIVERED;
  }
  if (validTimestamp(line.shipped_date) !== null) {
    return ORDER_STATUSES.SHIPPED;
  }
  if (
    rawLineStatus !== ORDER_STATUSES.CANCELED &&
    rawLineStatus !== ORDER_STATUSES.RETURNED
  ) {
    return rawLineStatus;
  }
  if (
    rawOrderStatus !== ORDER_STATUSES.CANCELED &&
    rawOrderStatus !== ORDER_STATUSES.RETURNED
  ) {
    return rawOrderStatus;
  }
  return ORDER_STATUSES.PENDING;
}

export function resolveRipleyLineStatus(
  line: RipleyOrderLine,
  rawLineStatus: StandardOrderStatus,
  rawOrderStatus: StandardOrderStatus,
): { status: StandardOrderStatus; refund: RipleyRefundAnalysis } {
  const refund = analyzeRipleyLineRefund(line);

  if (refund.classification === 'returned_after_delivery') {
    return { status: ORDER_STATUSES.RETURNED, refund };
  }
  if (refund.classification === 'canceled_before_delivery') {
    return { status: ORDER_STATUSES.CANCELED, refund };
  }
  if (
    refund.classification === 'partial_quantity' ||
    refund.classification === 'indeterminate'
  ) {
    return {
      status: resolveRipleyLogisticsStatus(line, rawLineStatus, rawOrderStatus),
      refund,
    };
  }

  return { status: rawLineStatus, refund };
}

export function getRipleyMarketplaceItemId(
  line: RipleyOrderLine,
  lineIndex: number,
): string {
  const lineId = cleanNullableString(line.order_line_id);
  if (lineId) return lineId;

  const sku =
    cleanNullableString(line.offer_sku) ??
    cleanNullableString(line.product_shop_sku) ??
    cleanNullableString(line.product_sku);
  return sku ? `${sku}:${lineIndex}` : `line:${lineIndex}`;
}

export function getRipleyUnitPrice(line: RipleyOrderLine): number {
  const quantity = Math.max(1, parseRipleyNumber(line.quantity));
  return parseRipleyNumber(line.price) / quantity;
}

/**
 * Representa cada unidad Mirakl en una fila estable de order_detail.
 * La primera conserva order_line_id para migrar sin duplicar la fila agregada
 * que pudiera existir; las siguientes usan identificadores derivados.
 */
export function expandRipleyOrderLineUnits(
  line: RipleyOrderLine,
  lineIndex: number,
  rawLineStatus: StandardOrderStatus,
  rawOrderStatus: StandardOrderStatus,
): RipleyLineExpansion {
  const baseItemId = getRipleyMarketplaceItemId(line, lineIndex);
  const refund = analyzeRipleyLineRefund(line);
  const purchasedQuantity = refund.purchasedQuantity;
  const fallbackStatus = resolveRipleyLogisticsStatus(
    line,
    rawLineStatus,
    rawOrderStatus,
  );
  const remainingStatus = refund.classification === 'none'
    ? rawLineStatus
    : fallbackStatus;

  if (!Number.isInteger(purchasedQuantity) || purchasedQuantity <= 0) {
    return {
      items: [
        {
          marketplaceItemId: baseItemId,
          productQuantity: Math.max(1, purchasedQuantity),
          productPrice: getRipleyUnitPrice(line),
          status: resolveRipleyLineStatus(
            line,
            rawLineStatus,
            rawOrderStatus,
          ).status,
        },
      ],
      refund,
      warning: `cantidad comprada no entera o invalida: ${purchasedQuantity}`,
    };
  }

  if (
    !Number.isInteger(refund.returnedQuantity) ||
    !Number.isInteger(refund.canceledQuantity)
  ) {
    return {
      items: [
        {
          marketplaceItemId: baseItemId,
          productQuantity: purchasedQuantity,
          productPrice: getRipleyUnitPrice(line),
          status: fallbackStatus,
        },
      ],
      refund,
      warning: `cantidad reembolsada no entera: ${refund.refundedQuantity}`,
    };
  }

  const returnedUnits = Math.min(purchasedQuantity, refund.returnedQuantity);
  const canceledUnits = Math.min(
    purchasedQuantity - returnedUnits,
    refund.canceledQuantity,
  );
  const items = Array.from({ length: purchasedQuantity }, (_, unitIndex) => {
    const status = unitIndex < returnedUnits
      ? ORDER_STATUSES.RETURNED
      : unitIndex < returnedUnits + canceledUnits
        ? ORDER_STATUSES.CANCELED
        : remainingStatus;

    return {
      marketplaceItemId:
        unitIndex === 0 ? baseItemId : `${baseItemId}:unit:${unitIndex + 1}`,
      productQuantity: 1,
      productPrice: getRipleyUnitPrice(line),
      status,
    };
  });

  return { items, refund, warning: null };
}

export function getRipleyShippingAmount(order: RipleyOrder): number {
  return parseRipleyNumber(order.shipping_price);
}

function dateOnly(value: unknown): string | null {
  const cleaned = cleanNullableString(value);
  if (!cleaned) return null;
  const match = cleaned.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== match[1]
    ? null
    : match[1];
}

export function calculateRipleyFallbackDeliveryDate(
  createdDate: unknown,
): string | null {
  const cleaned = cleanNullableString(createdDate);
  if (!cleaned) return null;
  const date = new Date(cleaned);
  if (Number.isNaN(date.getTime())) return null;

  date.setUTCDate(date.getUTCDate() + 1);
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 2);
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function getRipleyDeliveryDate(order: RipleyOrder): string | null {
  const apiDeliveryDate = dateOnly(order.delivery_date);
  if (apiDeliveryDate) return apiDeliveryDate;

  const committedDate = (order.order_additional_fields ?? []).find(
    (field) => field.code?.trim().toLowerCase() === 'commiteddate',
  )?.value;
  return dateOnly(committedDate) ?? calculateRipleyFallbackDeliveryDate(order.created_date);
}

export function findRipleyFiscalSignals(order: RipleyOrder): string[] {
  return (order.order_additional_fields ?? [])
    .map((field) => field.code?.trim() ?? '')
    .filter((code) => /rut|tax|invoice|factura|razon|company|business/i.test(code));
}

export function resolveRipleyHeaderStatus(
  orderStatus: StandardOrderStatus,
  itemStatuses: readonly StandardOrderStatus[],
): StandardOrderStatus {
  if (itemStatuses.length === 0) return orderStatus;
  if (itemStatuses.every((status) => status === ORDER_STATUSES.RETURNED)) {
    return ORDER_STATUSES.RETURNED;
  }
  if (itemStatuses.every((status) => status === ORDER_STATUSES.CANCELED)) {
    return ORDER_STATUSES.CANCELED;
  }
  if (
    itemStatuses.some((status) => status === ORDER_STATUSES.RETURNED) &&
    orderStatus === ORDER_STATUSES.RETURNED
  ) {
    return ORDER_STATUSES.DELIVERED;
  }
  return orderStatus;
}

export function resolveRipleyExistingHeaderStatus(
  currentStatus: string,
  incomingStatus: StandardOrderStatus,
) {
  const accepted =
    !isStandardOrderStatus(currentStatus) ||
    isValidOrderStatusTransition(currentStatus, incomingStatus);
  return { status: accepted ? incomingStatus : currentStatus, accepted };
}

export function hasCompletedRipleyProductRefund(order: RipleyOrder): boolean {
  return (order.order_lines ?? []).some(
    (line) => analyzeRipleyLineRefund(line).classification !== 'none',
  );
}
