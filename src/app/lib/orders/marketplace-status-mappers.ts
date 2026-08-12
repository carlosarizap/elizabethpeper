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

const MARKETPLACE_STATUS_MAPPERS: Readonly<
  Record<string, MarketplaceStatusMapper>
> = {
  [MARKETPLACES.FALABELLA]: normalizeFalabellaOrderStatus,
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
