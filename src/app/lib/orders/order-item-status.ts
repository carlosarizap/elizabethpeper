import { MARKETPLACES } from '../constants/marketplaces.ts';
import { normalizeExternalStatus } from './order-status.ts';

export const STANDARD_ORDER_ITEM_STATUSES = {
  PENDING: 'pendiente',
  SHIPPED: 'enviado',
  DELIVERED: 'recibido',
  CANCELED: 'cancelado',
  RETURNED: 'devuelto',
} as const;

export type StandardOrderItemStatus =
  (typeof STANDARD_ORDER_ITEM_STATUSES)[keyof typeof STANDARD_ORDER_ITEM_STATUSES];

export const STANDARD_ORDER_RETURN_STATUSES = {
  NONE: 'sin_devolucion',
  PARTIAL: 'devolucion_parcial',
  TOTAL: 'devolucion_total',
} as const;

export type StandardOrderReturnStatus =
  (typeof STANDARD_ORDER_RETURN_STATUSES)[keyof typeof STANDARD_ORDER_RETURN_STATUSES];

const FALABELLA_ORDER_ITEM_STATUS_MAP: Readonly<
  Record<string, StandardOrderItemStatus>
> = {
  pending: STANDARD_ORDER_ITEM_STATUSES.PENDING,
  ready_to_ship: STANDARD_ORDER_ITEM_STATUSES.PENDING,
  shipped: STANDARD_ORDER_ITEM_STATUSES.SHIPPED,
  delivered: STANDARD_ORDER_ITEM_STATUSES.DELIVERED,
  failed: STANDARD_ORDER_ITEM_STATUSES.CANCELED,
  canceled: STANDARD_ORDER_ITEM_STATUSES.CANCELED,
  cancelled: STANDARD_ORDER_ITEM_STATUSES.CANCELED,
  return_waiting_for_approval: STANDARD_ORDER_ITEM_STATUSES.DELIVERED,
  return_shipped_by_customer: STANDARD_ORDER_ITEM_STATUSES.DELIVERED,
  return_rejected: STANDARD_ORDER_ITEM_STATUSES.DELIVERED,
  returned: STANDARD_ORDER_ITEM_STATUSES.RETURNED,
};

const MERCADO_LIBRE_ORDER_ITEM_STATUS_MAP: Readonly<
  Record<string, StandardOrderItemStatus>
> = {
  cancelled: STANDARD_ORDER_ITEM_STATUSES.CANCELED,
  canceled: STANDARD_ORDER_ITEM_STATUSES.CANCELED,
  pending_cancel: STANDARD_ORDER_ITEM_STATUSES.CANCELED,
  not_delivered: STANDARD_ORDER_ITEM_STATUSES.CANCELED,
  delivered: STANDARD_ORDER_ITEM_STATUSES.DELIVERED,
  shipped: STANDARD_ORDER_ITEM_STATUSES.SHIPPED,
  pending: STANDARD_ORDER_ITEM_STATUSES.PENDING,
  handling: STANDARD_ORDER_ITEM_STATUSES.PENDING,
  ready_to_ship: STANDARD_ORDER_ITEM_STATUSES.PENDING,
  confirmed: STANDARD_ORDER_ITEM_STATUSES.PENDING,
  payment_required: STANDARD_ORDER_ITEM_STATUSES.PENDING,
  payment_in_process: STANDARD_ORDER_ITEM_STATUSES.PENDING,
  partially_paid: STANDARD_ORDER_ITEM_STATUSES.PENDING,
  partially_refunded: STANDARD_ORDER_ITEM_STATUSES.PENDING,
  paid: STANDARD_ORDER_ITEM_STATUSES.PENDING,
};

function normalizeRawStatus(value: unknown): string {
  return typeof value === 'string' ? normalizeExternalStatus(value) : '';
}

export function normalizeFalabellaOrderItemStatus(
  rawStatus: unknown,
): StandardOrderItemStatus {
  const normalizedStatus = normalizeRawStatus(rawStatus);
  const mappedStatus = FALABELLA_ORDER_ITEM_STATUS_MAP[normalizedStatus];

  if (!mappedStatus) {
    console.warn(
      `[OrderItemStatus] Estado desconocido para Falabella: ${String(rawStatus)}`,
    );
    return STANDARD_ORDER_ITEM_STATUSES.PENDING;
  }

  return mappedStatus;
}

export function normalizeMarketplaceOrderItemStatus(
  marketplace: string,
  rawStatus: unknown,
): StandardOrderItemStatus {
  if (marketplace === MARKETPLACES.FALABELLA) {
    return normalizeFalabellaOrderItemStatus(rawStatus);
  }

  if (marketplace === MARKETPLACES.MERCADO_LIBRE) {
    const normalizedStatus = normalizeRawStatus(rawStatus);
    const mappedStatus = MERCADO_LIBRE_ORDER_ITEM_STATUS_MAP[normalizedStatus];

    if (!mappedStatus) {
      console.warn(
        `[OrderItemStatus] Estado desconocido para Mercado Libre: ${String(rawStatus)}`,
      );
      return STANDARD_ORDER_ITEM_STATUSES.PENDING;
    }

    return mappedStatus;
  }

  console.warn(
    `[OrderItemStatus] Marketplace sin mapeador: ${marketplace}. Estado original: ${String(rawStatus)}`,
  );
  return STANDARD_ORDER_ITEM_STATUSES.PENDING;
}

export function resolveOrderItemStatusTransition(
  currentStatus: StandardOrderItemStatus | null,
  incomingStatus: StandardOrderItemStatus,
): StandardOrderItemStatus {
  if (!currentStatus) return incomingStatus;
  if (currentStatus === STANDARD_ORDER_ITEM_STATUSES.CANCELED) return currentStatus;
  if (incomingStatus === STANDARD_ORDER_ITEM_STATUSES.CANCELED) return incomingStatus;

  const priority: Record<Exclude<StandardOrderItemStatus, 'cancelado'>, number> = {
    [STANDARD_ORDER_ITEM_STATUSES.PENDING]: 1,
    [STANDARD_ORDER_ITEM_STATUSES.SHIPPED]: 2,
    [STANDARD_ORDER_ITEM_STATUSES.DELIVERED]: 3,
    [STANDARD_ORDER_ITEM_STATUSES.RETURNED]: 4,
  };

  return priority[incomingStatus] >= priority[currentStatus]
    ? incomingStatus
    : currentStatus;
}

export function calculateOrderReturnStatus(
  itemStatuses: readonly StandardOrderItemStatus[],
): StandardOrderReturnStatus {
  const returnedCount = itemStatuses.filter(
    (status) => status === STANDARD_ORDER_ITEM_STATUSES.RETURNED,
  ).length;

  if (returnedCount === 0) return STANDARD_ORDER_RETURN_STATUSES.NONE;
  if (returnedCount === itemStatuses.length) {
    return STANDARD_ORDER_RETURN_STATUSES.TOTAL;
  }
  return STANDARD_ORDER_RETURN_STATUSES.PARTIAL;
}
