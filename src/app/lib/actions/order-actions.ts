'use server';

import pool from '@/app/lib/db';
import { MARKETPLACES } from '../constants/marketplaces';
import {
  isStandardOrderStatus,
  isValidOrderStatusTransition,
  type StandardOrderStatus,
} from '../orders/order-status';
import {
  calculateOrderReturnStatus,
  resolveOrderItemStatusTransition,
  type StandardOrderItemStatus,
} from '../orders/order-item-status';

export async function createOrder(order: {
  orderId: string;
  shippingAmount?: number;
  status: StandardOrderStatus | string;
  marketplace?: string;
  documentType?: 'boleta' | 'factura';
  productTitle: string;
  productQuantity: number;
  productPrice: number;
  deliveryDate?: string;
}) {
  try {
    const client = await pool.connect();

    // Verificar si ya existe un header con el mismo orderId
    const exists = await client.query(
      'SELECT id, status FROM order_header WHERE order_id = $1',
      [order.orderId]
    );

    let orderHeaderId: string;

    if ((exists.rowCount ?? 0) > 0) {
      orderHeaderId = exists.rows[0].id;

      if (
        order.marketplace === MARKETPLACES.FALABELLA &&
        isStandardOrderStatus(order.status)
      ) {
        const currentStatus: string = exists.rows[0].status;
        const canUpdateStatus =
          !isStandardOrderStatus(currentStatus) ||
          isValidOrderStatusTransition(currentStatus, order.status);

        if (!canUpdateStatus) {
          console.warn(
            `[OrderStatus] TransiciÃ³n rechazada para orden ${order.orderId}: ${currentStatus} -> ${order.status}`,
          );
        }

        await client.query(
          `UPDATE order_header
           SET status = $1
           WHERE id = $2`,
          [canUpdateStatus ? order.status : currentStatus, orderHeaderId],
        );
      }

      // Verifica si la fecha actual difiere
      const checkDate = await client.query(
        'SELECT delivery_date, has_invoice, marketplace, invoice_uploaded, invoice_pdf, document_type FROM order_header WHERE id = $1',
        [orderHeaderId]
      );

      const existingDateRaw = checkDate.rows[0]?.delivery_date;
      const existingDate = existingDateRaw?.toISOString().split('T')[0] ?? null;
      const newDate = order.deliveryDate?.trim() || null;

      if (existingDate !== newDate) {
        // Actualizar si son diferentes, incluso si uno es null
        await client.query(
          `UPDATE order_header SET delivery_date = $1 WHERE id = $2`,
          [newDate, orderHeaderId]
        );

        if (
          checkDate.rows[0].has_invoice &&
          checkDate.rows[0].invoice_uploaded &&
          !checkDate.rows[0].invoice_pdf &&
          checkDate.rows[0].marketplace == MARKETPLACES.MERCADO_LIBRE &&
          checkDate.rows[0].document_type == "boleta"
        ) {
          await client.query(
            `UPDATE order_header SET invoice_uploaded = false, has_invoice  = false WHERE id = $1`,
            [orderHeaderId]
          );
        }

        console.log(`📅 Fecha actualizada para orden ${order.orderId}: ${existingDate} → ${newDate}`);
      }

    } else {
      const totalInicial = order.productQuantity * order.productPrice;

      const isMercadoFull = order.marketplace === 'mercado_libre' && !order.deliveryDate;

      const hasInvoice = isMercadoFull ? true : false;
      const invoiceUploaded = hasInvoice;

      const insertHeader = await client.query(
        `
        INSERT INTO order_header (
          order_id, 
          total_amount, 
          shipping_amount, 
          status,
          marketplace, 
          document_type,
          has_invoice,
          delivery_date,
          invoice_uploaded
        ) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
        `,
        [
          order.orderId,
          totalInicial,
          order.shippingAmount ?? 0,
          order.status,
          order.marketplace ?? 'mkp',
          order.documentType ?? 'boleta',
          hasInvoice,
          order.deliveryDate ?? null,
          invoiceUploaded,
        ]
      );

      orderHeaderId = insertHeader.rows[0].id;
    }

    // ⚡ Verificar si ya existe ese detalle
    const existsDetail = await client.query(
      `SELECT 1 FROM order_detail WHERE id_order_header = $1 AND product_title = $2 AND product_quantity = $3`,
      [orderHeaderId, order.productTitle, order.productQuantity]
    );

    const repeated = (existsDetail.rowCount ?? 0) > 0;

    if (!repeated) {
      // Insertar detalle solo si no existe
      await client.query(
        `
        INSERT INTO order_detail (
          id_order_header, 
          product_title, 
          product_quantity,
          product_price
        ) 
        VALUES ($1, $2, $3, $4)
        `,
        [
          orderHeaderId,
          order.productTitle,
          order.productQuantity,
          order.productPrice
        ]
      );

      // 🧮 Actualizar el total_amount del header sumando todos los detalles actuales
      await client.query(
        `
        UPDATE order_header
        SET total_amount = (
          SELECT COALESCE(SUM(product_quantity * product_price), 0)
          FROM order_detail
          WHERE id_order_header = $1
        )
        WHERE id = $1
        `,
        [orderHeaderId]
      );
    }

    client.release();
    return { success: true, repeated };

  } catch (error) {
    console.error('Error al crear orden:', error);
    return { error: 'Error al crear orden' };
  }
}

export interface FalabellaOrderItemInput {
  marketplaceItemId: string;
  productTitle: string;
  productQuantity: number;
  productPrice: number;
  status: StandardOrderItemStatus;
  marketplaceStatus: string | null;
}

export interface FalabellaOrderInput {
  orderId: string;
  shippingAmount: number;
  status: StandardOrderStatus;
  documentType: 'boleta' | 'factura';
  deliveryDate?: string | null;
  companyRut?: string | null;
  billingCity?: string | null;
  items: readonly FalabellaOrderItemInput[];
}

export async function upsertFalabellaOrder(order: FalabellaOrderInput) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingHeader = await client.query(
      `SELECT id, status, delivery_date, has_invoice, invoice_uploaded,
              invoice_pdf, marketplace, document_type
       FROM order_header
       WHERE order_id = $1
       FOR UPDATE`,
      [order.orderId],
    );

    let orderHeaderId: string;
    let repeated = false;

    if ((existingHeader.rowCount ?? 0) > 0) {
      const header = existingHeader.rows[0];
      orderHeaderId = header.id;
      const currentStatus: string = header.status;
      const canUpdateStatus =
        !isStandardOrderStatus(currentStatus) ||
        isValidOrderStatusTransition(currentStatus, order.status);

      if (!canUpdateStatus) {
        console.warn(
          `[OrderStatus] TransiciÃ³n rechazada para orden ${order.orderId}: ${currentStatus} -> ${order.status}`,
        );
      }

      const existingDate = header.delivery_date?.toISOString().split('T')[0] ?? null;
      const newDate = order.deliveryDate?.trim() || null;

      await client.query(
        `UPDATE order_header
         SET status = $1,
             shipping_amount = $2,
             delivery_date = $3,
             company_rut = COALESCE($4, company_rut),
             billing_city = COALESCE($5, billing_city),
             updated_at = NOW()
         WHERE id = $6`,
        [
          canUpdateStatus ? order.status : currentStatus,
          order.shippingAmount,
          newDate,
          order.companyRut ?? null,
          order.billingCity ?? null,
          orderHeaderId,
        ],
      );

      if (
        existingDate !== newDate &&
        header.has_invoice &&
        header.invoice_uploaded &&
        !header.invoice_pdf &&
        header.marketplace === MARKETPLACES.MERCADO_LIBRE &&
        header.document_type === 'boleta'
      ) {
        await client.query(
          `UPDATE order_header
           SET invoice_uploaded = false, has_invoice = false
           WHERE id = $1`,
          [orderHeaderId],
        );
      }
    } else {
      const insertedHeader = await client.query(
        `INSERT INTO order_header (
           order_id, total_amount, shipping_amount, status, marketplace,
           document_type, has_invoice, delivery_date, invoice_uploaded,
           return_status, company_rut, billing_city
         )
         VALUES (
           $1, 0, $2, $3, $4, $5, false, $6, false,
           'sin_devolucion', $7, $8
         )
         RETURNING id`,
        [
          order.orderId,
          order.shippingAmount,
          order.status,
          MARKETPLACES.FALABELLA,
          order.documentType,
          order.deliveryDate ?? null,
          order.companyRut ?? null,
          order.billingCity ?? null,
        ],
      );
      orderHeaderId = insertedHeader.rows[0].id;
    }

    for (const item of order.items) {
      let existingDetail = await client.query(
        `SELECT id, status
         FROM order_detail
         WHERE id_order_header = $1 AND marketplace_item_id = $2
         FOR UPDATE`,
        [orderHeaderId, item.marketplaceItemId],
      );

      if ((existingDetail.rowCount ?? 0) === 0) {
        existingDetail = await client.query(
          `SELECT id, status
           FROM order_detail
           WHERE id_order_header = $1
             AND marketplace_item_id IS NULL
             AND product_title = $2
             AND product_quantity = $3
           LIMIT 1
           FOR UPDATE`,
          [orderHeaderId, item.productTitle, item.productQuantity],
        );
      }

      if ((existingDetail.rowCount ?? 0) > 0) {
        repeated = true;
        const currentStatus = existingDetail.rows[0].status as StandardOrderItemStatus | null;
        const resolvedStatus = resolveOrderItemStatusTransition(
          currentStatus,
          item.status,
        );

        await client.query(
          `UPDATE order_detail
           SET marketplace_item_id = $1,
               product_title = $2,
               product_quantity = $3,
               product_price = $4,
               status = $5,
               marketplace_status = $6,
               status_updated_at = NOW()
           WHERE id = $7`,
          [
            item.marketplaceItemId,
            item.productTitle,
            item.productQuantity,
            item.productPrice,
            resolvedStatus,
            item.marketplaceStatus,
            existingDetail.rows[0].id,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO order_detail (
             id_order_header, marketplace_item_id, product_title,
             product_quantity, product_price, status, marketplace_status,
             status_updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [
            orderHeaderId,
            item.marketplaceItemId,
            item.productTitle,
            item.productQuantity,
            item.productPrice,
            item.status,
            item.marketplaceStatus,
          ],
        );
      }
    }

    const synchronizedProductTitles = Array.from(
      new Set(order.items.map((item) => item.productTitle)),
    );

    if (synchronizedProductTitles.length > 0) {
      await client.query(
        `DELETE FROM order_detail
         WHERE id_order_header = $1
           AND marketplace_item_id IS NULL
           AND product_title = ANY($2::text[])`,
        [orderHeaderId, synchronizedProductTitles],
      );
    }

    await client.query(
      `UPDATE order_header
       SET total_amount = (
         SELECT COALESCE(SUM(product_quantity * product_price), 0)
         FROM order_detail
         WHERE id_order_header = $1
       )
       WHERE id = $1`,
      [orderHeaderId],
    );

    const itemStatusRows = await client.query(
      'SELECT status FROM order_detail WHERE id_order_header = $1',
      [orderHeaderId],
    );
    const returnStatus = calculateOrderReturnStatus(
      itemStatusRows.rows.map(
        (row: { status: StandardOrderItemStatus }) => row.status,
      ),
    );

    await client.query(
      `UPDATE order_header
       SET return_status = $1, return_updated_at = NOW()
       WHERE id = $2`,
      [returnStatus, orderHeaderId],
    );

    await client.query('COMMIT');
    return { success: true, repeated, orderHeaderId, returnStatus };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al sincronizar orden de Falabella:', error);
    return { error: 'Error al sincronizar orden de Falabella' };
  } finally {
    client.release();
  }
}
