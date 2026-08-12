export const ORDER_STATUSES = {
  PENDING: 'pendiente',
  SHIPPED: 'enviado',
  DELIVERED: 'recibido',
  RETURNED: 'devuelto',
  CANCELED: 'cancelado',
} as const;

export type StandardOrderStatus =
  (typeof ORDER_STATUSES)[keyof typeof ORDER_STATUSES];

const VALID_TRANSITIONS: Record<
  StandardOrderStatus,
  readonly StandardOrderStatus[]
> = {
  [ORDER_STATUSES.PENDING]: [
    ORDER_STATUSES.PENDING,
    ORDER_STATUSES.SHIPPED,
    ORDER_STATUSES.DELIVERED,
    ORDER_STATUSES.RETURNED,
    ORDER_STATUSES.CANCELED,
  ],
  [ORDER_STATUSES.SHIPPED]: [
    ORDER_STATUSES.SHIPPED,
    ORDER_STATUSES.DELIVERED,
    ORDER_STATUSES.RETURNED,
    ORDER_STATUSES.CANCELED,
  ],
  [ORDER_STATUSES.DELIVERED]: [
    ORDER_STATUSES.DELIVERED,
    ORDER_STATUSES.RETURNED,
  ],
  [ORDER_STATUSES.RETURNED]: [ORDER_STATUSES.RETURNED],
  [ORDER_STATUSES.CANCELED]: [ORDER_STATUSES.CANCELED],
};

export function normalizeExternalStatus(status: string): string {
  return status.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function isStandardOrderStatus(
  status: string,
): status is StandardOrderStatus {
  return Object.values(ORDER_STATUSES).some((value) => value === status);
}

export function isValidOrderStatusTransition(
  currentStatus: StandardOrderStatus,
  nextStatus: StandardOrderStatus,
): boolean {
  return VALID_TRANSITIONS[currentStatus].includes(nextStatus);
}
