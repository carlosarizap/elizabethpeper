import pool from '@/app/lib/db';
import {
  downloadFalabellaShippingParcelPdfs,
  fetchFalabellaOrderItems,
  markFalabellaOrderReadyToShip,
} from '@/app/lib/falabella/seller-center-client';

export interface FalabellaPrintCandidate {
  id: string;
  orderId: string;
  sellerCenterOrderId: string;
  orderItemIds: string[];
}

export function falabellaPrintError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/E034|E119|not yet ready|must be packed|todav.a no habilita/i.test(message)) {
    return 'Falabella todavía no habilita la etiqueta o la confirmación para esta fecha.';
  }
  if (/E020|Invalid Order Item/i.test(message)) {
    return 'Falabella no reconoce los ítems de esta orden.';
  }
  if (/fulfillment|own[_ ]warehouse/i.test(message)) {
    return 'La orden es administrada por Falabella y no se procesa desde este módulo.';
  }
  const apiMessage = message.match(/E\d{3}:[^\n]{1,240}/i)?.[0];
  if (apiMessage) return `Falabella rechazó la confirmación: ${apiMessage}`;
  return 'No fue posible obtener y confirmar la etiqueta en Falabella.';
}

/**
 * Obtiene la etiqueta antes de cambiar el estado remoto. La orden solo se
 * considera preparada cuando Falabella también la deja en ready_to_ship.
 */
export async function prepareFalabellaLabelAndConfirm(
  candidate: FalabellaPrintCandidate,
): Promise<Uint8Array[]> {
  const documents = await downloadFalabellaShippingParcelPdfs(candidate.orderItemIds);
  const items = await fetchFalabellaOrderItems(candidate.sellerCenterOrderId);

  if (items.length === 0) throw new Error('La orden no tiene ítems procesables.');
  if (items.some((item) => /fulfillment|own[_ ]warehouse/i.test(item.shippingType ?? ''))) {
    throw new Error('La orden es administrada por Falabella y no se procesa desde este módulo.');
  }

  const alreadyConfirmed = items.every((item) => item.status === 'ready_to_ship');
  if (!alreadyConfirmed) {
    if (items.some((item) => item.status !== 'pending' || !item.isProcessable)) {
      throw new Error('Falabella todavía no permite confirmar esta orden.');
    }
    const packageIds = [...new Set(items.map((item) => item.packageId).filter(Boolean))];
    if (packageIds.length > 1) {
      throw new Error('Falabella entregó más de un paquete para la misma orden.');
    }
    await markFalabellaOrderReadyToShip(
      items.map((item) => item.orderItemId),
      {
        packageId: packageIds[0] ?? null,
        shippingType: items[0].shippingType,
        shippingProvider: items[0].shipmentProvider,
        trackingNumber: items[0].trackingNumber,
      },
    );
  }

  await pool.query(
    `UPDATE order_detail
     SET marketplace_status = 'ready_to_ship', status_updated_at = NOW()
     WHERE id_order_header = $1
       AND marketplace_item_id = ANY($2::text[])`,
    [candidate.id, items.map((item) => item.orderItemId)],
  );

  return documents;
}
