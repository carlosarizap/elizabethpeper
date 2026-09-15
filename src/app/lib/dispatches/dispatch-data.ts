import pool from '@/app/lib/db';
import { MARKETPLACES } from '../constants/marketplaces';
import {
  canMarkMercadoLibreShipmentReady,
  getMercadoLibreLabelEligibility,
  isMercadoLibreShipmentWaitingForLabel,
} from '../mercadolibre/shipping-labels';
import type {
  MercadoLibreDispatchOrder,
  MercadoLibreDispatchResponse,
} from './definitions';

interface DispatchRow {
  id: string;
  order_id: string;
  delivery_date: string | null;
  delivery_deadline: Date | string | null;
  delivery_date_source: string | null;
  status: string;
  product_summary: string | null;
  total_units: string | number;
  shipment_id: string | null;
  external_shipment_id: string | null;
  shipment_status: string | null;
  shipment_substatus: string | null;
  shipping_mode: string | null;
  logistic_type: string | null;
  print_count: string | number;
  last_print_requested_at: Date | string | null;
}

export async function fetchMercadoLibreDispatchOrders(): Promise<MercadoLibreDispatchResponse> {
  const client = await pool.connect();

  try {
    const result = await client.query<DispatchRow>(
      `SELECT
         oh.id,
         oh.order_id,
         TO_CHAR(
           oh.delivery_date AT TIME ZONE 'America/Santiago',
           'YYYY-MM-DD'
         ) AS delivery_date,
         oh.delivery_date AS delivery_deadline,
         oh.delivery_date_source,
         oh.status,
         products.product_summary,
         products.total_units,
         ms.id AS shipment_id,
         ms.external_shipment_id,
         ms.status AS shipment_status,
         ms.substatus AS shipment_substatus,
         ms.shipping_mode,
         ms.logistic_type,
         COALESCE(print_stats.print_count, 0) AS print_count,
         print_stats.last_print_requested_at
       FROM order_header oh
       JOIN marketplace_shipment ms
         ON ms.id_order_header = oh.id
        AND ms.marketplace = $1
       LEFT JOIN LATERAL (
         SELECT
           (
             SELECT STRING_AGG(
               grouped.product_title || ' ×' || grouped.total_quantity::text,
               ' · ' ORDER BY grouped.product_title
             )
             FROM (
               SELECT grouped_od.product_title, SUM(grouped_od.product_quantity) AS total_quantity
               FROM order_detail grouped_od
               WHERE grouped_od.id_order_header = oh.id
               GROUP BY grouped_od.product_title
             ) grouped
           ) AS product_summary,
           COALESCE(SUM(od.product_quantity), 0) AS total_units
         FROM order_detail od
         WHERE od.id_order_header = oh.id
       ) products ON true
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) FILTER (WHERE dbi.status = 'completed') AS print_count,
           MAX(dbi.print_requested_at) AS last_print_requested_at
         FROM dispatch_batch_item dbi
         WHERE dbi.marketplace_shipment_id = ms.id
       ) print_stats ON true
       WHERE oh.marketplace = $1
         AND (
           oh.delivery_date IS NULL
           OR (oh.delivery_date AT TIME ZONE 'America/Santiago')::date
             >= (NOW() AT TIME ZONE 'America/Santiago')::date
         )
         AND COALESCE(oh.status, 'pendiente') = 'pendiente'
         AND ms.shipping_mode = 'me2'
         AND ms.logistic_type IN ('drop_off', 'xd_drop_off', 'cross_docking', 'self_service')
         AND (
           (ms.status = 'ready_to_ship' AND ms.substatus IN ('ready_to_print', 'printed'))
           OR (ms.status = 'pending' AND ms.substatus = 'manufacturing')
           OR (ms.status = 'handling' AND ms.substatus = 'waiting_for_label_generation')
         )
       ORDER BY
         (oh.delivery_date IS NOT NULL) ASC,
         (oh.delivery_date AT TIME ZONE 'America/Santiago')::date ASC,
         oh.order_id ASC,
         ms.external_shipment_id ASC`,
      [MARKETPLACES.MERCADO_LIBRE],
    );

    const orders: MercadoLibreDispatchOrder[] = result.rows.map((row) => {
      const shipment = row.shipment_id && row.external_shipment_id
        ? {
            id: row.shipment_id,
            externalShipmentId: row.external_shipment_id,
            status: row.shipment_status,
            substatus: row.shipment_substatus,
            shippingMode: row.shipping_mode,
            logisticType: row.logistic_type,
          }
        : null;
      const snapshot = shipment
        ? {
            status: shipment.status,
            substatus: shipment.substatus,
            mode: shipment.shippingMode,
            logisticType: shipment.logisticType,
          }
        : null;
      const eligibility = getMercadoLibreLabelEligibility(snapshot);
      const waitingForLabel = isMercadoLibreShipmentWaitingForLabel(snapshot);

      return {
        id: row.id,
        orderId: row.order_id,
        deliveryDate: row.delivery_date,
        deliveryDeadline: row.delivery_deadline
          ? new Date(row.delivery_deadline).toISOString()
          : null,
        deliveryDatePredicted: row.delivery_date_source === 'predicted',
        status: row.status,
        productSummary: row.product_summary ?? 'Sin productos',
        totalUnits: Number(row.total_units),
        shipment,
        eligible: eligibility.eligible,
        waitingForLabel,
        canMarkReadyToShip: canMarkMercadoLibreShipmentReady(snapshot),
        eligibilityReason: waitingForLabel
          ? row.delivery_date_source === 'predicted'
            ? 'Fecha estimada según el historial; Mercado Libre confirmará el horario al generar la etiqueta.'
            : 'Mercado Libre todavía no ha generado la etiqueta.'
          : eligibility.reason,
        printCount: Number(row.print_count),
        lastPrintRequestedAt: row.last_print_requested_at
          ? new Date(row.last_print_requested_at).toISOString()
          : null,
      };
    });

    return {
      orders,
      summary: {
        total: orders.length,
        eligible: orders.filter((order) => order.eligible).length,
        pendingPrint: orders.filter((order) => order.eligible && order.printCount === 0).length,
        printed: orders.filter((order) => order.printCount > 0).length,
        waitingForLabel: orders.filter((order) => order.waitingForLabel).length,
      },
      generatedAt: new Date().toISOString(),
    };
  } finally {
    client.release();
  }
}
