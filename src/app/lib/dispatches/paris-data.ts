import pool from '@/app/lib/db';
import { MARKETPLACES } from '../constants/marketplaces';
import type { ParisDispatchOrder, ParisDispatchResponse } from './definitions';

interface ParisRow {
  id: string;
  order_id: string;
  delivery_date: string;
  product_summary: string | null;
  total_units: string | number;
  item_statuses: string[] | null;
  print_count: string | number;
  last_print_requested_at: Date | string | null;
}

export async function fetchParisDispatchOrders(): Promise<ParisDispatchResponse> {
  const result = await pool.query<ParisRow>(
    `SELECT
       oh.id,
       oh.order_id,
       TO_CHAR(oh.delivery_date::date, 'YYYY-MM-DD') AS delivery_date,
       details.product_summary,
       details.total_units,
       details.item_statuses,
       COALESCE(print_stats.print_count, 0) AS print_count,
       print_stats.last_print_requested_at
     FROM order_header oh
     JOIN LATERAL (
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
         COALESCE(SUM(od.product_quantity), 0) AS total_units,
         ARRAY_AGG(LOWER(COALESCE(od.marketplace_status, ''))) AS item_statuses
       FROM order_detail od
       WHERE od.id_order_header = oh.id
     ) details ON true
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*) FILTER (WHERE dbi.status = 'completed') AS print_count,
         MAX(dbi.print_requested_at) AS last_print_requested_at
       FROM dispatch_batch_item dbi
       WHERE dbi.id_order_header = oh.id
     ) print_stats ON true
     WHERE oh.marketplace = $1
       AND oh.delivery_date IS NOT NULL
       AND oh.delivery_date::date >= (NOW() AT TIME ZONE 'America/Santiago')::date
       AND COALESCE(oh.status, 'pendiente') = 'pendiente'
       AND EXISTS (
         SELECT 1 FROM order_detail od
         WHERE od.id_order_header = oh.id
           AND LOWER(COALESCE(od.marketplace_status, '')) IN ('ready_to_ship', 'printed_label')
       )
     ORDER BY oh.delivery_date::date, oh.order_id`,
    [MARKETPLACES.PARIS],
  );

  const orders: ParisDispatchOrder[] = result.rows.map((row) => ({
    id: row.id,
    orderId: row.order_id,
    deliveryDate: row.delivery_date,
    productSummary: row.product_summary ?? 'Sin productos',
    totalUnits: Number(row.total_units),
    itemStatuses: row.item_statuses ?? [],
    printCount: Number(row.print_count),
    lastPrintRequestedAt: row.last_print_requested_at
      ? new Date(row.last_print_requested_at).toISOString()
      : null,
  }));

  return {
    orders,
    summary: {
      total: orders.length,
      pendingPrint: orders.filter((order) => order.printCount === 0).length,
      printed: orders.filter((order) => order.printCount > 0).length,
    },
    generatedAt: new Date().toISOString(),
  };
}
