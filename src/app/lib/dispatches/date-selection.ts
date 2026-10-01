export interface DispatchDateSelectionOrder {
  key: string;
  deliveryDate: string | null;
  selectable: boolean;
  printCount: number;
}

/**
 * Selecciona automáticamente un solo día operativo: hoy cuando tiene
 * etiquetas pendientes o, en su defecto, la próxima fecha disponible. Las
 * órdenes sin fecha confirmada permanecen visibles, pero requieren selección
 * manual para evitar mezclarlas accidentalmente con el lote diario.
 */
export function selectionForCurrentDispatchDate(
  orders: readonly DispatchDateSelectionOrder[],
  today: string,
): Set<string> {
  const pendingDated = orders.filter((order) => (
    order.selectable
    && order.printCount === 0
    && Boolean(order.deliveryDate)
  ));
  const availableDates = [...new Set(
    pendingDated
      .map((order) => order.deliveryDate)
      .filter((date): date is string => Boolean(date)),
  )].sort();

  const targetDate = availableDates.includes(today)
    ? today
    : availableDates.find((date) => date > today)
      ?? availableDates.at(-1)
      ?? null;

  if (!targetDate) return new Set();
  return new Set(
    pendingDated
      .filter((order) => order.deliveryDate === targetDate)
      .map((order) => order.key),
  );
}

/**
 * Detecta pedidos urgentes que aparecieron durante la sincronización previa a
 * imprimir. El centro de despacho usa este resultado para detener el lote y
 * obligar a que la persona vea y confirme los pedidos recién incorporados.
 */
export function newlyDiscoveredPendingOrdersForToday(
  before: readonly DispatchDateSelectionOrder[],
  after: readonly DispatchDateSelectionOrder[],
  today: string,
): Set<string> {
  const knownKeys = new Set(before.map((order) => order.key));
  return new Set(
    after
      .filter((order) => (
        !knownKeys.has(order.key)
        && order.selectable
        && order.printCount === 0
        && order.deliveryDate === today
      ))
      .map((order) => order.key),
  );
}
