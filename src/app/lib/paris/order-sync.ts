import dayjs from 'dayjs';
import {
  cleanNullableString,
  normalizeChileanRut,
} from '../falabella/invoice-data.ts';
import {
  isStandardOrderStatus,
  isValidOrderStatusTransition,
  type StandardOrderStatus,
} from '../orders/order-status.ts';

export interface ParisStatusPayload {
  id?: number | string | null;
  name?: string | null;
  description?: string | null;
}

export interface ParisItemPayload {
  id?: number | string | null;
  sku?: number | string | null;
  sellerSku?: number | string | null;
  name?: string | null;
  position?: number | string | null;
  priceAfterDiscounts?: number | string | null;
  statusId?: number | string | null;
  status?: ParisStatusPayload | string | null;
  returnId?: number | string | null;
  return?: unknown;
}

export interface ParisAddressPayload {
  city?: string | null;
  stateCode?: string | null;
  communaCode?: string | null;
}

export interface ParisBusinessInvoicePayload {
  companyRut?: string | null;
  comuna?: string | null;
  region?: string | null;
  address?: string | null;
}

export interface ParisSubOrderPayload {
  id?: number | string | null;
  subOrderNumber?: number | string | null;
  originInvoiceType?: string | null;
  cost?: number | string | null;
  dispatchCost?: number | string | null;
  dispatchDate?: string | null;
  arrivalDate?: string | null;
  arrivalDateEnd?: string | null;
  effectiveArrivalDate?: string | null;
  status?: ParisStatusPayload | string | null;
  shippingAddress?: ParisAddressPayload | null;
  billingAddress?: ParisAddressPayload | null;
  items?: ParisItemPayload[] | null;
}

export interface ParisOrderPayload {
  originInvoiceType?: string | null;
  businessInvoice?: ParisBusinessInvoicePayload | null;
  billingAddress?: ParisAddressPayload | null;
  subOrders?: ParisSubOrderPayload[] | null;
}

export interface ParisInvoiceData {
  companyRut: string | null;
  billingCity: string | null;
}

export function resolveParisExistingHeaderState(
  currentStatus: string,
  currentDocumentType: 'boleta' | 'factura',
  hasInvoice: boolean,
  incomingStatus: StandardOrderStatus,
  incomingDocumentType: 'boleta' | 'factura',
) {
  const statusWasAccepted =
    !isStandardOrderStatus(currentStatus) ||
    isValidOrderStatusTransition(currentStatus, incomingStatus);

  return {
    status: statusWasAccepted ? incomingStatus : currentStatus,
    documentType:
      hasInvoice || currentDocumentType === 'factura'
        ? currentDocumentType
        : incomingDocumentType,
    statusWasAccepted,
  };
}

export function getParisRawStatus(
  status: ParisStatusPayload | string | null | undefined,
): string | null {
  if (typeof status === 'string') return cleanNullableString(status);
  return cleanNullableString(status?.name);
}

export function getParisInvoiceData(
  order: ParisOrderPayload,
  subOrder?: ParisSubOrderPayload | null,
): ParisInvoiceData {
  const cityCandidates = [
    order.businessInvoice?.comuna,
    order.billingAddress?.city,
    order.billingAddress?.communaCode,
    subOrder?.billingAddress?.city,
    subOrder?.billingAddress?.communaCode,
    subOrder?.shippingAddress?.city,
    subOrder?.shippingAddress?.communaCode,
  ];

  let billingCity: string | null = null;
  for (const candidate of cityCandidates) {
    billingCity = cleanNullableString(candidate);
    if (billingCity) break;
  }

  return {
    companyRut: normalizeChileanRut(order.businessInvoice?.companyRut),
    billingCity,
  };
}

export function getParisDocumentType(
  order: ParisOrderPayload,
  subOrder?: ParisSubOrderPayload | null,
): 'boleta' | 'factura' {
  const originInvoiceType =
    cleanNullableString(subOrder?.originInvoiceType) ??
    cleanNullableString(order.originInvoiceType);

  return originInvoiceType?.toLowerCase() === 'factura' ? 'factura' : 'boleta';
}

export function getParisMarketplaceItemId(
  item: ParisItemPayload,
  itemIndex: number,
): string {
  const itemId = item.id == null ? null : cleanNullableString(String(item.id));
  if (itemId) return itemId;

  const sku = item.sellerSku ?? item.sku;
  const normalizedSku = sku == null ? null : cleanNullableString(String(sku));
  const position = item.position ?? itemIndex;

  if (normalizedSku) return `${normalizedSku}:${String(position)}`;
  return `position:${String(position)}`;
}

export function parseParisMoney(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getParisShippingAmount(subOrder: ParisSubOrderPayload): number {
  return parseParisMoney(subOrder.cost ?? subOrder.dispatchCost);
}

function validDate(value: unknown): string | null {
  const cleaned = cleanNullableString(value);
  if (!cleaned) return null;

  const calendarDate = cleaned.match(/^(\d{4}-\d{2}-\d{2})/);
  if (calendarDate) {
    const parsedCalendarDate = dayjs(calendarDate[1]);
    if (
      parsedCalendarDate.isValid() &&
      parsedCalendarDate.format('YYYY-MM-DD') === calendarDate[1]
    ) {
      return calendarDate[1];
    }
  }

  const parsed = dayjs(cleaned);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
}

export function getParisDeliveryDate(
  subOrder: ParisSubOrderPayload,
): string | null {
  // La fecha operativa usada por la vista de órdenes es el compromiso de
  // entrega al courier. arrivalDate corresponde a la promesa al cliente y
  // puede ser uno o varios días posterior.
  const dispatchDate = validDate(subOrder.dispatchDate);
  if (dispatchDate) return dispatchDate;

  const fallbackCandidates = [
    subOrder.effectiveArrivalDate,
    subOrder.arrivalDate,
    subOrder.arrivalDateEnd,
  ];

  for (const candidate of fallbackCandidates) {
    const date = validDate(candidate);
    if (date) return date;
  }
  return null;
}
