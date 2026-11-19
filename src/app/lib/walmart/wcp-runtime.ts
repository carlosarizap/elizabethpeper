import pool from '../db';
import type { WalmartOrder } from './order-sync.ts';
import { prepareWcpLabels, type StoredWcpLabel, type WcpDependencies } from './wcp-labels.ts';

export async function prepareStoredWcpLabels(
  order: WalmartOrder,
  api: Pick<WcpDependencies, 'request' | 'download' | 'acknowledge'>,
  packages?: unknown,
) {
  const client = await pool.connect();
  const orderId = String(order.purchaseOrderId);
  let locked = false;
  let destroyed = false;
  try {
    const lock = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked`, [`walmart-label:${orderId}`],
    );
    locked = lock.rows[0].locked;
    if (!locked) throw new Error('Esta orden Walmart ya está preparando sus etiquetas. Espera a que termine.');
    return await prepareWcpLabels(order, {
      ...api,
      store: {
        async list() {
          const result = await client.query<{
            package_key: string; status: StoredWcpLabel['status']; request_payload: StoredWcpLabel['request'];
            product_summary: string; tracking_number: string | null; document_pdf: Buffer | null;
          }>(`SELECT * FROM walmart_dispatch_label WHERE purchase_order_id = $1 ORDER BY split_part(package_key, ':', 2)::int`, [orderId]);
          return result.rows.map((r) => ({
            key: r.package_key, status: r.status, request: r.request_payload,
            productSummary: r.product_summary, trackingNumber: r.tracking_number, document: r.document_pdf,
          }));
        },
        async savePlan(packages) {
          await client.query('BEGIN');
          try {
            await client.query(`DELETE FROM walmart_dispatch_label WHERE purchase_order_id = $1 AND status IN ('planned', 'failed')`, [orderId]);
            for (const pkg of packages) {
              await client.query(
                `INSERT INTO walmart_dispatch_label (purchase_order_id, package_key, request_payload, product_summary, status)
                 VALUES ($1, $2, $3, $4, 'planned')`,
                [orderId, pkg.key, JSON.stringify(pkg.request), pkg.productSummary],
              );
            }
            await client.query('COMMIT');
          } catch (error) { await client.query('ROLLBACK'); throw error; }
        },
        async start(key) {
          const result = await client.query(
            `UPDATE walmart_dispatch_label SET status = 'creating', error_message = NULL, updated_at = NOW()
             WHERE purchase_order_id = $1 AND package_key = $2 AND status IN ('planned', 'failed') RETURNING package_key`,
            [orderId, key],
          );
          if (result.rowCount !== 1) throw new Error('Ya existe una solicitud de etiqueta pendiente para este bulto.');
        },
        async ready(pkg, trackingNumber, document) {
          await client.query(
            `INSERT INTO walmart_dispatch_label
               (purchase_order_id, package_key, request_payload, product_summary, status, tracking_number, document_pdf)
             VALUES ($1, $2, $3, $4, 'ready', $5, $6)
             ON CONFLICT (purchase_order_id, package_key) DO UPDATE SET
               status = 'ready', tracking_number = EXCLUDED.tracking_number, document_pdf = EXCLUDED.document_pdf,
               error_message = NULL, updated_at = NOW()`,
            [orderId, pkg.key, JSON.stringify(pkg.request), pkg.productSummary, trackingNumber, Buffer.from(document)],
          );
        },
        async fail(key, status, message) {
          await client.query(
            `UPDATE walmart_dispatch_label SET status = $3, error_message = $4, updated_at = NOW()
             WHERE purchase_order_id = $1 AND package_key = $2 AND status <> 'ready'`,
            [orderId, key, status, message],
          );
        },
      },
    }, packages);
  } finally {
    if (locked) {
      // Destroy a connection whose session lock could not be released.
      try { await client.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [`walmart-label:${orderId}`]); }
      catch { client.release(true); destroyed = true; }
    }
    if (!destroyed) client.release();
  }
}
