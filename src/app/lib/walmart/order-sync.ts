import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
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

dayjs.extend(utc);
dayjs.extend(timezone);

export interface WalmartMoney {
  amount?: string | number | null;
  currency?: string | null;
}

export interface WalmartCharge {
  chargeType?: string | null;
  chargeName?: string | null;
  chargeAmount?: WalmartMoney | null;
  tax?: { taxAmount?: WalmartMoney | null } | null;
  isDiscount?: boolean | null;
  discountType?: string | null;
}

export interface WalmartOrderLineStatus {
  status?: string | null;
  statusQuantity?: { amount?: string | number | null } | null;
}

export interface WalmartOrderLine {
  lineNumber?: string | number | null;
  item?: { productName?: string | null; sku?: string | null } | null;
  charges?: { charge?: WalmartCharge | WalmartCharge[] | null } | null;
  orderLineQuantity?: { amount?: string | number | null } | null;
  orderLineStatuses?: {
    orderLineStatus?: WalmartOrderLineStatus | WalmartOrderLineStatus[] | null;
  } | null;
  [key: string]: unknown;
}

export interface WalmartOrder {
  purchaseOrderId?: string | number | null;
  customerOrderId?: string | number | null;
  orderDate?: string | number | null;
  shippingInfo?: {
    estimatedDeliveryDate?: string | number | null;
    estimatedShipDate?: string | number | null;
    postalAddress?: Record<string, unknown> | null;
  } | null;
  kycDetails?: Record<string, unknown> | null;
  orderLines?: { orderLine?: WalmartOrderLine | WalmartOrderLine[] | null } | null;
  [key: string]: unknown;
}

export interface WalmartReturnLine {
  purchaseOrderId?: string | null;
  purchaseOrderLineNumber?: string | number | null;
  status?: string | null;
  statusTime?: string | null;
  quantity?: {
    amount?: string | number | null;
    measurementValue?: string | number | null;
  } | null;
}

export interface WalmartReturnOrder {
  returnOrderId?: string | null;
  customerOrderId?: string | null;
  returnOrderLines?: WalmartReturnLine[] | WalmartReturnLine | null;
}

export interface WalmartReturnSummary {
  completedQuantity: number;
  latestStatus: string | null;
  latestStatusTime: number;
}

export interface WalmartExpandedItem {
  marketplaceItemId: string;
  productTitle: string;
  productQuantity: number;
  productPrice: number;
  status: StandardOrderItemStatus;
  marketplaceStatus: string | null;
}

export function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseWalmartNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedChargeName(charge: WalmartCharge): string {
  return `${charge.chargeType ?? ''}:${charge.chargeName ?? ''}`.toUpperCase();
}

function chargeGrossAmount(charge: WalmartCharge): number {
  return (
    parseWalmartNumber(charge.chargeAmount?.amount) +
    parseWalmartNumber(charge.tax?.taxAmount?.amount)
  );
}

function isShippingDiscount(charge: WalmartCharge): boolean {
  return /SHIP/.test(normalizedChargeName(charge));
}

export function getWalmartLineProductTotal(line: WalmartOrderLine): number {
  const charges = toArray(line.charges?.charge);
  const productCharges = charges.filter(
    (charge) => charge.chargeType?.toUpperCase() === 'PRODUCT',
  );
  const afterDiscount = productCharges.find(
    (charge) => charge.chargeName?.toUpperCase() === 'ITEM_PRICE_AFTER_DISCOUNT',
  );
  const itemPrice = productCharges.find(
    (charge) => charge.chargeName?.toUpperCase() === 'ITEMPRICE',
  );
  const selectedProductCharge = afterDiscount ?? itemPrice ?? productCharges[0];
  const productGross = selectedProductCharge
    ? chargeGrossAmount(selectedProductCharge)
    : 0;
  const discounts = charges
    .filter(
      (charge) =>
        !isShippingDiscount(charge) &&
        (charge.chargeType?.toUpperCase() === 'DISCOUNT' ||
          charge.isDiscount === true),
    )
    .reduce((sum, charge) => sum + Math.abs(chargeGrossAmount(charge)), 0);

  return Math.max(0, productGross - discounts);
}

export function getWalmartUnitPrice(line: WalmartOrderLine): number {
  const quantity = Math.max(1, parseWalmartNumber(line.orderLineQuantity?.amount));
  return getWalmartLineProductTotal(line) / quantity;
}

export function getWalmartShippingAmount(order: WalmartOrder): number {
  let shippingGross = 0;
  let shippingDiscount = 0;

  for (const line of toArray(order.orderLines?.orderLine)) {
    for (const charge of toArray(line.charges?.charge)) {
      const chargeType = charge.chargeType?.toUpperCase();
      if (chargeType === 'SHIPPING' && charge.isDiscount !== true) {
        shippingGross += chargeGrossAmount(charge);
      } else if (
        isShippingDiscount(charge) &&
        (chargeType === 'DISCOUNT' || charge.isDiscount === true)
      ) {
        shippingDiscount += Math.abs(chargeGrossAmount(charge));
      }
    }
  }

  return Math.max(0, shippingGross - shippingDiscount);
}

function walmartTimestamp(value: unknown): dayjs.Dayjs | null {
  if (typeof value === 'number' || /^\d+$/.test(String(value ?? '').trim())) {
    const numericValue = Number(value);
    const milliseconds = numericValue < 10_000_000_000
      ? numericValue * 1000
      : numericValue;
    const parsed = dayjs(milliseconds);
    return parsed.isValid() ? parsed : null;
  }

  const parsed = dayjs(String(value ?? ''));
  return parsed.isValid() ? parsed : null;
}

export function getWalmartOrderDate(order: WalmartOrder): string | null {
  const parsed = walmartTimestamp(order.orderDate);
  return parsed ? parsed.toISOString() : null;
}

export function getWalmartDeliveryDate(order: WalmartOrder): string | null {
  const candidates = [
    order.shippingInfo?.estimatedDeliveryDate,
    order.shippingInfo?.estimatedShipDate,
  ];

  for (const candidate of candidates) {
    const parsed = walmartTimestamp(candidate);
    if (parsed) return parsed.tz('America/Santiago').format('YYYY-MM-DD');
  }
  return null;
}

export function getWalmartMarketplaceItemId(
  purchaseOrderId: string,
  lineNumber: string | number,
  unitIndex = 0,
): string {
  const baseId = `${purchaseOrderId}:${String(lineNumber)}`;
  return unitIndex === 0 ? baseId : `${baseId}:unit:${unitIndex + 1}`;
}

export function getWalmartRawLineStatuses(
  line: WalmartOrderLine,
): WalmartOrderLineStatus[] {
  return toArray(line.orderLineStatuses?.orderLineStatus);
}

function getWalmartLogisticUnits(
  line: WalmartOrderLine,
): Array<{ status: StandardOrderItemStatus; rawStatus: string | null }> {
  const purchasedQuantity = parseWalmartNumber(line.orderLineQuantity?.amount);
  const quantity = Number.isInteger(purchasedQuantity) && purchasedQuantity > 0
    ? purchasedQuantity
    : 1;
  const rawStatuses = getWalmartRawLineStatuses(line);
  const result: Array<{ status: StandardOrderItemStatus; rawStatus: string | null }> = [];

  // Walmart conserva estados anteriores al dividir cantidades. Se recorren
  // desde el más reciente para no contar dos veces la misma unidad.
  for (const rawStatus of [...rawStatuses].reverse()) {
    if (result.length >= quantity) break;
    const remaining = quantity - result.length;
    const reportedQuantity = parseWalmartNumber(rawStatus.statusQuantity?.amount);
    const unitsForStatus = reportedQuantity > 0
      ? Math.min(remaining, Math.trunc(reportedQuantity))
      : remaining;
    const normalized = normalizeMarketplaceOrderItemStatus(
      MARKETPLACES.WALMART,
      rawStatus.status,
    );
    for (let index = 0; index < unitsForStatus; index += 1) {
      result.push({ status: normalized, rawStatus: rawStatus.status ?? null });
    }
  }

  while (result.length < quantity) {
    result.push({
      status: STANDARD_ORDER_ITEM_STATUSES.PENDING,
      rawStatus: rawStatuses.at(-1)?.status ?? null,
    });
  }
  return result;
}

export function normalizeWalmartReturnStatus(
  status: string | null | undefined,
): 'initiated' | 'completed' | 'cancelled' | 'unknown' {
  const normalized = String(status ?? '')
    .trim()
    .toUpperCase()
    .replace(/^RETURN_/, '');
  if (normalized === 'COMPLETED') return 'completed';
  if (normalized === 'CANCELLED' || normalized === 'CANCELED') return 'cancelled';
  if (normalized === 'INITIATED' || normalized === 'DELIVERED') return 'initiated';
  return 'unknown';
}

function returnQuantity(line: WalmartReturnLine): number {
  const amount = parseWalmartNumber(line.quantity?.amount);
  if (amount > 0) return amount;
  return parseWalmartNumber(line.quantity?.measurementValue);
}

export function collectWalmartReturnSummaries(
  returnOrders: readonly WalmartReturnOrder[],
): Map<string, WalmartReturnSummary> {
  const summaries = new Map<string, WalmartReturnSummary>();

  for (const returnOrder of returnOrders) {
    for (const line of toArray(returnOrder.returnOrderLines)) {
      const purchaseOrderId = String(line.purchaseOrderId ?? '').trim();
      const lineNumber = String(line.purchaseOrderLineNumber ?? '').trim();
      if (!purchaseOrderId || !lineNumber) continue;

      const key = `${purchaseOrderId}:${lineNumber}`;
      const current = summaries.get(key) ?? {
        completedQuantity: 0,
        latestStatus: null,
        latestStatusTime: Number.NEGATIVE_INFINITY,
      };
      if (normalizeWalmartReturnStatus(line.status) === 'completed') {
        current.completedQuantity += Math.max(0, returnQuantity(line));
      }

      const statusTime = Date.parse(line.statusTime ?? '');
      const comparableTime = Number.isFinite(statusTime) ? statusTime : 0;
      if (comparableTime >= current.latestStatusTime) {
        current.latestStatus = line.status ?? null;
        current.latestStatusTime = comparableTime;
      }
      summaries.set(key, current);
    }
  }
  return summaries;
}

export function expandWalmartOrderLineUnits(
  purchaseOrderId: string,
  line: WalmartOrderLine,
  lineIndex: number,
  returns?: ReadonlyMap<string, WalmartReturnSummary>,
): WalmartExpandedItem[] {
  const lineNumber = String(line.lineNumber ?? lineIndex + 1);
  const baseId = `${purchaseOrderId}:${lineNumber}`;
  const logistics = getWalmartLogisticUnits(line);
  const returnSummary = returns?.get(baseId);
  let remainingReturnedUnits = Math.min(
    logistics.length,
    Math.max(0, Math.trunc(returnSummary?.completedQuantity ?? 0)),
  );
  const returnedIndexes = new Set<number>();

  // Una devolución de cliente se aplica primero a unidades no canceladas.
  for (let index = 0; index < logistics.length && remainingReturnedUnits > 0; index += 1) {
    if (logistics[index].status !== STANDARD_ORDER_ITEM_STATUSES.CANCELED) {
      returnedIndexes.add(index);
      remainingReturnedUnits -= 1;
    }
  }

  if ((returnSummary?.completedQuantity ?? 0) > logistics.length) {
    console.warn(
      `[Walmart][ReturnQuantity] La devolución ${baseId} informa ${returnSummary?.completedQuantity} unidades para una compra de ${logistics.length}.`,
    );
  }

  const productTitle = line.item?.productName?.trim() || line.item?.sku?.trim() || 'Sin titulo';
  const productPrice = getWalmartUnitPrice(line);
  return logistics.map((unit, unitIndex) => {
    const returned = returnedIndexes.has(unitIndex);
    return {
      marketplaceItemId: getWalmartMarketplaceItemId(
        purchaseOrderId,
        lineNumber,
        unitIndex,
      ),
      productTitle,
      productQuantity: 1,
      productPrice,
      status: returned ? STANDARD_ORDER_ITEM_STATUSES.RETURNED : unit.status,
      marketplaceStatus: returned
        ? 'RETURN_COMPLETED'
        : returnSummary?.latestStatus ?? unit.rawStatus,
    };
  });
}

export function resolveWalmartOrderStatus(
  itemStatuses: readonly StandardOrderItemStatus[],
): StandardOrderStatus {
  if (itemStatuses.length === 0) return ORDER_STATUSES.PENDING;
  if (itemStatuses.every((status) => status === ORDER_STATUSES.RETURNED)) {
    return ORDER_STATUSES.RETURNED;
  }
  if (itemStatuses.every((status) => status === ORDER_STATUSES.CANCELED)) {
    return ORDER_STATUSES.CANCELED;
  }

  const activeStatuses = itemStatuses.filter(
    (status) =>
      status !== ORDER_STATUSES.RETURNED &&
      status !== ORDER_STATUSES.CANCELED,
  );
  if (activeStatuses.includes(ORDER_STATUSES.DELIVERED)) return ORDER_STATUSES.DELIVERED;
  if (activeStatuses.includes(ORDER_STATUSES.SHIPPED)) return ORDER_STATUSES.SHIPPED;
  if (activeStatuses.includes(ORDER_STATUSES.PENDING)) return ORDER_STATUSES.PENDING;

  // Una mezcla de unidades devueltas y canceladas implica que sí existió una
  // venta entregada antes de la devolución.
  return itemStatuses.includes(ORDER_STATUSES.RETURNED)
    ? ORDER_STATUSES.DELIVERED
    : ORDER_STATUSES.CANCELED;
}

export function resolveWalmartExistingHeaderStatus(
  currentStatus: string,
  incomingStatus: StandardOrderStatus,
) {
  const accepted =
    !isStandardOrderStatus(currentStatus) ||
    isValidOrderStatusTransition(currentStatus, incomingStatus);
  return { status: accepted ? incomingStatus : currentStatus, accepted };
}

export function normalizeWalmartCursor(cursor: string | null | undefined): string | null {
  const cleaned = cursor?.trim().replace(/^\?/, '');
  return !cleaned || cleaned === '-1' ? null : cleaned;
}

export function findWalmartFiscalSignals(order: WalmartOrder): string[] {
  const candidates = [
    ...Object.keys(order),
    ...Object.keys(order.kycDetails ?? {}),
    ...Object.keys(order.shippingInfo?.postalAddress ?? {}),
  ];
  return candidates.filter((key) => /invoice|factura|business|company|tax|rut|kyc/i.test(key));
}
