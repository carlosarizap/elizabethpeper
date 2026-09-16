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
