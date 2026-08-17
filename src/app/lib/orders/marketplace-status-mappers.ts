import { MARKETPLACES } from '../constants/marketplaces.ts';
import {
  normalizeExternalStatus,
  ORDER_STATUSES,
  type StandardOrderStatus,
} from './order-status.ts';

type MarketplaceStatusMapper = (
  status: string | null | undefined,
) => StandardOrderStatus;

const FALABELLA_STATUS_MAP: Readonly<Record<string, StandardOrderStatus>> = {
  pending: ORDER_STATUSES.PENDING,
  ready_to_ship: ORDER_STATUSES.PENDING,
  shipped: ORDER_STATUSES.SHIPPED,
  delivered: ORDER_STATUSES.DELIVERED,
  returned: ORDER_STATUSES.RETURNED,
  failed: ORDER_STATUSES.CANCELED,
  canceled: ORDER_STATUSES.CANCELED,
};

export function normalizeFalabellaOrderStatus(
  status: string | null | undefined,
): StandardOrderStatus {
  const normalizedStatus = status ? normalizeExternalStatus(status) : '';
  const mappedStatus = FALABELLA_STATUS_MAP[normalizedStatus];

  if (!mappedStatus) {
    console.warn(`[OrderStatus] Estado desconocido para Falabella: ${status}`);
    return ORDER_STATUSES.PENDING;
  }

  return mappedStatus;
}

const MERCADO_LIBRE_STATUS_MAP: Readonly<Record<string, StandardOrderStatus>> = {
  cancelled: ORDER_STATUSES.CANCELED,
  canceled: ORDER_STATUSES.CANCELED,
  pending_cancel: ORDER_STATUSES.CANCELED,
  not_delivered: ORDER_STATUSES.CANCELED,
  delivered: ORDER_STATUSES.DELIVERED,
  shipped: ORDER_STATUSES.SHIPPED,
  pending: ORDER_STATUSES.PENDING,
  handling: ORDER_STATUSES.PENDING,
  ready_to_ship: ORDER_STATUSES.PENDING,
  confirmed: ORDER_STATUSES.PENDING,
  payment_required: ORDER_STATUSES.PENDING,
  payment_in_process: ORDER_STATUSES.PENDING,
  partially_paid: ORDER_STATUSES.PENDING,
  partially_refunded: ORDER_STATUSES.PENDING,
  paid: ORDER_STATUSES.PENDING,
};

export function normalizeMercadoLibreOrderStatus(
  status: string | null | undefined,
): StandardOrderStatus {
  const normalizedStatus = status ? normalizeExternalStatus(status) : '';
  const mappedStatus = MERCADO_LIBRE_STATUS_MAP[normalizedStatus];

  if (!mappedStatus) {
    console.warn(`[OrderStatus] Estado desconocido para Mercado Libre: ${status}`);
    return ORDER_STATUSES.PENDING;
  }

  return mappedStatus;
}

const PARIS_STATUS_MAP: Readonly<Record<string, StandardOrderStatus>> = {
  ready_to_ship: ORDER_STATUSES.PENDING,
  printed_label: ORDER_STATUSES.PENDING,
  shipped: ORDER_STATUSES.SHIPPED,
  available_at_store: ORDER_STATUSES.SHIPPED,
  delivered: ORDER_STATUSES.DELIVERED,
  cancelled: ORDER_STATUSES.CANCELED,
  canceled: ORDER_STATUSES.CANCELED,
  stock_shortage_refunded: ORDER_STATUSES.CANCELED,
  returned: ORDER_STATUSES.RETURNED,
  returned_to_seller: ORDER_STATUSES.RETURNED,
};

export function normalizeParisOrderStatus(
  status: string | null | undefined,
): StandardOrderStatus {
  const normalizedStatus = status ? normalizeExternalStatus(status) : '';
  const mappedStatus = PARIS_STATUS_MAP[normalizedStatus];

  if (!mappedStatus) {
    console.warn(`[OrderStatus] Estado desconocido para Paris: ${status}`);
    return ORDER_STATUSES.PENDING;
  }

  return mappedStatus;
}

export function resolveParisOrderStatus(
  subOrderStatus: string | null | undefined,
  itemStatuses: readonly StandardOrderStatus[],
): StandardOrderStatus {
  const baseStatus = normalizeParisOrderStatus(subOrderStatus);
  if (itemStatuses.length === 0) return baseStatus;

  const returnedCount = itemStatuses.filter(
    (status) => status === ORDER_STATUSES.RETURNED,
  ).length;

  if (returnedCount === itemStatuses.length) return ORDER_STATUSES.RETURNED;
  if (returnedCount > 0 && baseStatus === ORDER_STATUSES.RETURNED) {
    return ORDER_STATUSES.DELIVERED;
  }
  return baseStatus;
}

export function resolveMercadoLibreOrderStatus(
  orderStatus: string | null | undefined,
  shipmentStatus: string | null | undefined,
): StandardOrderStatus {
  if (shipmentStatus) return normalizeMercadoLibreOrderStatus(shipmentStatus);
  return normalizeMercadoLibreOrderStatus(orderStatus);
}

export function aggregateMercadoLibreOrderStatuses(
  statuses: readonly StandardOrderStatus[],
): StandardOrderStatus {
  if (statuses.includes(ORDER_STATUSES.DELIVERED)) return ORDER_STATUSES.DELIVERED;
  if (statuses.includes(ORDER_STATUSES.SHIPPED)) return ORDER_STATUSES.SHIPPED;
  if (statuses.includes(ORDER_STATUSES.PENDING)) return ORDER_STATUSES.PENDING;
  if (statuses.includes(ORDER_STATUSES.RETURNED)) return ORDER_STATUSES.RETURNED;
  return ORDER_STATUSES.CANCELED;
}

const MARKETPLACE_STATUS_MAPPERS: Readonly<
  Record<string, MarketplaceStatusMapper>
> = {
  [MARKETPLACES.FALABELLA]: normalizeFalabellaOrderStatus,
  [MARKETPLACES.MERCADO_LIBRE]: normalizeMercadoLibreOrderStatus,
  [MARKETPLACES.PARIS]: normalizeParisOrderStatus,
};

export function normalizeOrderStatus(
  marketplace: string,
  marketplaceStatus: string | null | undefined,
): StandardOrderStatus {
  const mapper = MARKETPLACE_STATUS_MAPPERS[marketplace];

  if (!mapper) {
    console.warn(
      `[OrderStatus] Marketplace sin mapeador: ${marketplace}. Estado original: ${marketplaceStatus}`,
    );
    return ORDER_STATUSES.PENDING;
  }

  return mapper(marketplaceStatus);
}
