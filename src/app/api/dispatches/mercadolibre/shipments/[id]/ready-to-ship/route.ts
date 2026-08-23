import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { MARKETPLACES } from '@/app/lib/constants/marketplaces';
import {
  canMarkMercadoLibreShipmentReady,
  fetchMercadoLibreShipmentSnapshot,
  getMercadoLibreLabelEligibility,
  markMercadoLibreShipmentReadyToShip,
  type MercadoLibreShipmentSnapshot,
} from '@/app/lib/mercadolibre/shipping-labels';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ShipmentRow {
  id: string;
  external_shipment_id: string;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function saveSnapshot(id: string, snapshot: MercadoLibreShipmentSnapshot) {
  await pool.query(
    `UPDATE marketplace_shipment
     SET status = $1, substatus = $2, shipping_mode = $3,
         logistic_type = $4, tracking_number = $5, updated_at = NOW()
     WHERE id = $6`,
    [
      snapshot.status,
      snapshot.substatus,
      snapshot.mode,
      snapshot.logisticType,
      snapshot.trackingNumber,
      id,
    ],
  );
}

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'El envío no es válido.' }, { status: 400 });
  }

  try {
    const result = await pool.query<ShipmentRow>(
      `SELECT ms.id, ms.external_shipment_id
       FROM marketplace_shipment ms
       JOIN order_header oh ON oh.id = ms.id_order_header
       WHERE ms.id = $1
         AND ms.marketplace = $2
         AND oh.marketplace = $2
         AND COALESCE(oh.status, 'pendiente') = 'pendiente'
         AND oh.delivery_date IS NOT NULL
         AND oh.delivery_date::date >= (NOW() AT TIME ZONE 'America/Santiago')::date`,
      [id, MARKETPLACES.MERCADO_LIBRE],
    );
    const shipment = result.rows[0];
    if (!shipment) {
      return NextResponse.json(
        { error: 'La orden ya no está disponible para esta acción.' },
        { status: 404 },
      );
    }

    let snapshot = await fetchMercadoLibreShipmentSnapshot(shipment.external_shipment_id);
    await saveSnapshot(shipment.id, snapshot);

    if (getMercadoLibreLabelEligibility(snapshot).eligible) {
      return NextResponse.json({
        success: true,
        readyToPrint: true,
        message: 'La etiqueta ya está disponible para imprimir.',
      });
    }
    if (!canMarkMercadoLibreShipmentReady(snapshot)) {
      return NextResponse.json(
        {
          error: 'Mercado Libre ya cambió el estado de esta orden. Actualizamos la lista para reflejarlo.',
        },
        { status: 409 },
      );
    }

    await markMercadoLibreShipmentReadyToShip(shipment.external_shipment_id);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await wait(700);
      snapshot = await fetchMercadoLibreShipmentSnapshot(shipment.external_shipment_id);
      await saveSnapshot(shipment.id, snapshot);
      if (getMercadoLibreLabelEligibility(snapshot).eligible) break;
    }

    const readyToPrint = getMercadoLibreLabelEligibility(snapshot).eligible;
    return NextResponse.json({
      success: true,
      readyToPrint,
      message: readyToPrint
        ? 'Mercado Libre generó la etiqueta. Ya puedes imprimirla.'
        : 'Mercado Libre recibió la confirmación y está generando la etiqueta.',
    });
  } catch (error) {
    console.error('Error marking Mercado Libre shipment ready:', error);
    return NextResponse.json(
      { error: 'No fue posible confirmar el stock en Mercado Libre. Intenta nuevamente.' },
      { status: 502 },
    );
  }
}
