'use server';

import pool from '@/app/lib/db';
import { MARKETPLACES } from '../constants/marketplaces';
import {
  isStandardOrderStatus,
  isValidOrderStatusTransition,
  ORDER_STATUSES,
  type StandardOrderStatus,
} from '../orders/order-status';
import {
  calculateOrderReturnStatus,
  resolveOrderItemStatusTransition,
  STANDARD_ORDER_ITEM_STATUSES,
  type StandardOrderItemStatus,
} from '../orders/order-item-status';
import { resolveParisExistingHeaderState } from '../paris/order-sync';
import { resolveRipleyExistingHeaderStatus } from '../ripley/order-sync';
import { resolveWalmartExistingHeaderStatus } from '../walmart/order-sync';

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

export interface MercadoLibreOrderItemInput extends FalabellaOrderItemInput {
  marketplaceOrderId: string;
}

export interface MercadoLibreOrderInput {
  orderId: string;
  shippingAmount: number;
  status: StandardOrderStatus;
  documentType: 'boleta' | 'factura';
  deliveryDate?: string | null;
  companyRut?: string | null;
  billingCity?: string | null;
  items: readonly MercadoLibreOrderItemInput[];
}

export async function upsertMercadoLibreOrder(order: MercadoLibreOrderInput) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`mercado_libre:${order.orderId}`],
    );

    const existingHeader = await client.query(
      `SELECT id, status, delivery_date, has_invoice, invoice_uploaded,
              invoice_pdf, marketplace, document_type
       FROM order_header
       WHERE order_id = $1 AND marketplace = $2
       FOR UPDATE`,
      [order.orderId, MARKETPLACES.MERCADO_LIBRE],
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
          `[OrderStatus] Transicion rechazada para orden Mercado Libre ${order.orderId}: ${currentStatus} -> ${order.status}`,
        );
      }

      const existingDate = header.delivery_date?.toISOString().split('T')[0] ?? null;
      const newDate = order.deliveryDate?.trim() || null;
      const documentType = header.has_invoice || header.document_type === 'factura'
        ? header.document_type
        : order.documentType;
      await client.query(
        `UPDATE order_header
         SET status = $1,
             shipping_amount = $2,
             delivery_date = $3,
             document_type = $4,
             company_rut = COALESCE($5, company_rut),
             billing_city = COALESCE($6, billing_city),
             marketplace = $7,
             updated_at = NOW()
         WHERE id = $8`,
        [
          canUpdateStatus ? order.status : currentStatus,
          order.shippingAmount,
          newDate,
          documentType,
          order.companyRut ?? null,
          order.billingCity ?? null,
          MARKETPLACES.MERCADO_LIBRE,
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
      const isMercadoFull = !order.deliveryDate;
      const insertedHeader = await client.query(
        `INSERT INTO order_header (
           order_id, total_amount, shipping_amount, status, marketplace,
           document_type, has_invoice, delivery_date, invoice_uploaded,
           return_status, company_rut, billing_city
         )
         VALUES (
           $1, 0, $2, $3, $4, $5, $6, $7, $6,
           'sin_devolucion', $8, $9
         )
         RETURNING id`,
        [
          order.orderId,
          order.shippingAmount,
          order.status,
          MARKETPLACES.MERCADO_LIBRE,
          order.documentType,
          isMercadoFull,
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
         WHERE id_order_header = $1
           AND marketplace_order_id = $2
           AND marketplace_item_id = $3
         FOR UPDATE`,
        [orderHeaderId, item.marketplaceOrderId, item.marketplaceItemId],
      );

      if ((existingDetail.rowCount ?? 0) === 0) {
        existingDetail = await client.query(
          `SELECT id, status
           FROM order_detail
           WHERE id_order_header = $1
             AND marketplace_order_id IS NULL
             AND marketplace_item_id = $2
           LIMIT 1
           FOR UPDATE`,
          [orderHeaderId, item.marketplaceItemId],
        );
      }

      if ((existingDetail.rowCount ?? 0) === 0) {
        existingDetail = await client.query(
          `SELECT id, status
           FROM order_detail
           WHERE id_order_header = $1
             AND marketplace_order_id IS NULL
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
           SET marketplace_order_id = $1,
               marketplace_item_id = $2,
               product_title = $3,
               product_quantity = $4,
               product_price = $5,
               status = $6,
               marketplace_status = $7,
               status_updated_at = NOW(),
               updated_at = NOW()
           WHERE id = $8`,
          [
            item.marketplaceOrderId,
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
             id_order_header, marketplace_order_id, marketplace_item_id,
             product_title, product_quantity, product_price, status,
             marketplace_status, status_updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            orderHeaderId,
            item.marketplaceOrderId,
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
           AND marketplace_order_id IS NULL
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
    console.error('Error al sincronizar orden de Mercado Libre:', error);
    return { error: 'Error al sincronizar orden de Mercado Libre' };
  } finally {
    client.release();
  }
}

export type ParisOrderItemInput = FalabellaOrderItemInput;

export interface ParisOrderInput {
  orderId: string;
  shippingAmount: number;
  status: StandardOrderStatus;
  documentType: 'boleta' | 'factura';
  deliveryDate?: string | null;
  companyRut?: string | null;
  billingCity?: string | null;
  items: readonly ParisOrderItemInput[];
}

export async function upsertParisOrder(order: ParisOrderInput) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`paris:${order.orderId}`],
    );

    const existingHeader = await client.query(
      `SELECT id, status, has_invoice, document_type
       FROM order_header
       WHERE order_id = $1 AND marketplace = $2
       FOR UPDATE`,
      [order.orderId, MARKETPLACES.PARIS],
    );

    let orderHeaderId: string;
    let repeated = false;

    if ((existingHeader.rowCount ?? 0) > 0) {
      const header = existingHeader.rows[0];
      orderHeaderId = header.id;
      const currentStatus: string = header.status;
      const resolvedHeader = resolveParisExistingHeaderState(
        currentStatus,
        header.document_type,
        header.has_invoice,
        order.status,
        order.documentType,
      );

      if (!resolvedHeader.statusWasAccepted) {
        console.warn(
          `[OrderStatus] Transicion rechazada para orden Paris ${order.orderId}: ${currentStatus} -> ${order.status}`,
        );
      }

      await client.query(
        `UPDATE order_header
         SET status = $1,
             shipping_amount = $2,
             delivery_date = $3,
             document_type = $4,
             company_rut = COALESCE($5, company_rut),
             billing_city = COALESCE($6, billing_city),
             marketplace = $7,
             updated_at = NOW()
         WHERE id = $8`,
        [
          resolvedHeader.status,
          order.shippingAmount,
          order.deliveryDate?.trim() || null,
          resolvedHeader.documentType,
          order.companyRut ?? null,
          order.billingCity ?? null,
          MARKETPLACES.PARIS,
          orderHeaderId,
        ],
      );
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
          MARKETPLACES.PARIS,
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
           LIMIT 1
           FOR UPDATE`,
          [orderHeaderId, item.productTitle],
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
               status_updated_at = NOW(),
               updated_at = NOW()
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
       SET return_status = $1::varchar,
           return_updated_at = NOW(),
           status = CASE
             WHEN $1::varchar = 'devolucion_total'::varchar THEN 'devuelto'
             ELSE status
           END,
           updated_at = NOW()
       WHERE id = $2`,
      [returnStatus, orderHeaderId],
    );

    await client.query('COMMIT');
    return { success: true, repeated, orderHeaderId, returnStatus };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al sincronizar orden de Paris:', error);
    return { error: 'Error al sincronizar orden de Paris' };
  } finally {
    client.release();
  }
}

export type RipleyOrderItemInput = FalabellaOrderItemInput;

export interface RipleyOrderInput {
  orderId: string;
  shippingAmount: number;
  status: StandardOrderStatus;
  deliveryDate?: string | null;
  items: readonly RipleyOrderItemInput[];
}

function resolveRipleyExistingItemStatus(
  currentStatus: StandardOrderItemStatus | null,
  currentMarketplaceStatus: string | null,
  incomingStatus: StandardOrderItemStatus,
  incomingMarketplaceStatus: string | null,
): StandardOrderItemStatus {
  const fixesPreviousShippingMapping =
    currentStatus === STANDARD_ORDER_ITEM_STATUSES.SHIPPED &&
    incomingStatus === STANDARD_ORDER_ITEM_STATUSES.PENDING &&
    currentMarketplaceStatus?.trim().toUpperCase() === 'SHIPPING' &&
    incomingMarketplaceStatus?.trim().toUpperCase() === 'SHIPPING';

  return fixesPreviousShippingMapping
    ? STANDARD_ORDER_ITEM_STATUSES.PENDING
    : resolveOrderItemStatusTransition(currentStatus, incomingStatus);
}

export async function upsertRipleyOrder(order: RipleyOrderInput) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`ripley:${order.orderId}`],
    );

    const existingHeader = await client.query(
      `SELECT id, status, has_invoice, document_type
       FROM order_header
       WHERE order_id = $1 AND marketplace = $2
       FOR UPDATE`,
      [order.orderId, MARKETPLACES.RIPLEY],
    );

    let orderHeaderId: string;
    let repeated = false;

    if ((existingHeader.rowCount ?? 0) > 0) {
      const header = existingHeader.rows[0];
      orderHeaderId = header.id;
      const resolvedHeader = resolveRipleyExistingHeaderStatus(
        header.status,
        order.status,
      );

      if (!resolvedHeader.accepted) {
        console.warn(
          `[OrderStatus] Transicion rechazada para orden Ripley ${order.orderId}: ${header.status} -> ${order.status}`,
        );
      }

      await client.query(
        `UPDATE order_header
         SET status = $1,
             shipping_amount = $2,
             delivery_date = $3,
             document_type = CASE WHEN has_invoice THEN document_type ELSE 'boleta' END,
             marketplace = $4,
             updated_at = NOW()
         WHERE id = $5`,
        [
          resolvedHeader.status,
          order.shippingAmount,
          order.deliveryDate?.trim() || null,
          MARKETPLACES.RIPLEY,
          orderHeaderId,
        ],
      );
    } else {
      const insertedHeader = await client.query(
        `INSERT INTO order_header (
           order_id, total_amount, shipping_amount, status, marketplace,
           document_type, has_invoice, delivery_date, invoice_uploaded,
           return_status
         )
         VALUES ($1, 0, $2, $3, $4, 'boleta', false, $5, false, 'sin_devolucion')
         RETURNING id`,
        [
          order.orderId,
          order.shippingAmount,
          order.status,
          MARKETPLACES.RIPLEY,
          order.deliveryDate ?? null,
        ],
      );
      orderHeaderId = insertedHeader.rows[0].id;
    }

    for (const item of order.items) {
      let existingDetail = await client.query(
        `SELECT id, status, marketplace_status
         FROM order_detail
         WHERE id_order_header = $1 AND marketplace_item_id = $2
         FOR UPDATE`,
        [orderHeaderId, item.marketplaceItemId],
      );

      if ((existingDetail.rowCount ?? 0) === 0) {
        existingDetail = await client.query(
          `SELECT id, status, marketplace_status
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

      if ((existingDetail.rowCount ?? 0) === 0) {
        existingDetail = await client.query(
          `SELECT id, status, marketplace_status
           FROM order_detail
           WHERE id_order_header = $1
             AND marketplace_item_id IS NULL
             AND product_title = $2
           LIMIT 1
           FOR UPDATE`,
          [orderHeaderId, item.productTitle],
        );
      }

      if ((existingDetail.rowCount ?? 0) > 0) {
        repeated = true;
        const currentStatus = existingDetail.rows[0].status as StandardOrderItemStatus | null;
        const resolvedStatus = resolveRipleyExistingItemStatus(
          currentStatus,
          existingDetail.rows[0].marketplace_status,
          item.status,
          item.marketplaceStatus,
        );

        await client.query(
          `UPDATE order_detail
           SET marketplace_item_id = $1,
               product_title = $2,
               product_quantity = $3,
               product_price = $4,
               status = $5,
               marketplace_status = $6,
               status_updated_at = NOW(),
               updated_at = NOW()
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

    if (order.status === ORDER_STATUSES.PENDING) {
      await client.query(
        `UPDATE order_header oh
         SET status = $1,
             updated_at = NOW()
         WHERE oh.id = $2
           AND oh.status = $3
           AND NOT EXISTS (
             SELECT 1
             FROM order_detail od
             WHERE od.id_order_header = oh.id
               AND od.status <> $1
           )`,
        [ORDER_STATUSES.PENDING, orderHeaderId, ORDER_STATUSES.SHIPPED],
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
       SET return_status = $1::varchar,
           return_updated_at = NOW(),
           status = CASE
             WHEN $1::varchar = 'devolucion_total'::varchar THEN 'devuelto'
             ELSE status
           END,
           updated_at = NOW()
       WHERE id = $2`,
      [returnStatus, orderHeaderId],
    );

    await client.query('COMMIT');
    return { success: true, repeated, orderHeaderId, returnStatus };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al sincronizar orden de Ripley:', error);
    return { error: 'Error al sincronizar orden de Ripley' };
  } finally {
    client.release();
  }
}

export async function getMercadoLibreOrderIdsToRecheck(
  days = 120,
): Promise<string[]> {
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT DISTINCT COALESCE(od.marketplace_order_id, oh.order_id) AS external_order_id
       FROM order_header oh
       LEFT JOIN order_detail od ON od.id_order_header = oh.id
       WHERE oh.marketplace = $1
         AND oh.created_at >= NOW() - ($2::int * INTERVAL '1 day')
         AND oh.status IN ('enviado', 'recibido')
         AND COALESCE(oh.return_status, 'sin_devolucion') <> 'devolucion_total'`,
      [MARKETPLACES.MERCADO_LIBRE, Math.max(1, Math.trunc(days))],
    );

    return result.rows
      .map((row: { external_order_id: unknown }) => String(row.external_order_id ?? ''))
      .filter(Boolean);
  } finally {
    client.release();
  }
}

export interface WalmartOrderItemInput {
  marketplaceItemId: string;
  productTitle: string;
  productQuantity: number;
  productPrice: number;
  status: StandardOrderItemStatus;
  marketplaceStatus: string | null;
}

export interface WalmartOrderInput {
  orderId: string;
  shippingAmount: number;
  status: StandardOrderStatus;
  deliveryDate?: string | null;
  items: readonly WalmartOrderItemInput[];
}

export async function upsertWalmartOrder(order: WalmartOrderInput) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`walmart:${order.orderId}`],
    );

    const existingHeader = await client.query(
      `SELECT id, status, has_invoice, document_type
       FROM order_header
       WHERE order_id = $1 AND marketplace = $2
       FOR UPDATE`,
      [order.orderId, MARKETPLACES.WALMART],
    );

    let orderHeaderId: string;
    let repeated = (existingHeader.rowCount ?? 0) > 0;

    if (repeated) {
      const header = existingHeader.rows[0];
      orderHeaderId = header.id;
      const resolvedHeader = resolveWalmartExistingHeaderStatus(
        header.status,
        order.status,
      );

      if (!resolvedHeader.accepted) {
        console.warn(
          `[OrderStatus] Transicion rechazada para orden Walmart ${order.orderId}: ${header.status} -> ${order.status}`,
        );
      }

      await client.query(
        `UPDATE order_header
         SET status = $1,
             shipping_amount = $2,
             delivery_date = $3,
             document_type = CASE WHEN has_invoice THEN document_type ELSE 'boleta' END,
             marketplace = $4,
             updated_at = NOW()
         WHERE id = $5`,
        [
          resolvedHeader.status,
          order.shippingAmount,
          order.deliveryDate?.trim() || null,
          MARKETPLACES.WALMART,
          orderHeaderId,
        ],
      );
    } else {
      const insertedHeader = await client.query(
        `INSERT INTO order_header (
           order_id, total_amount, shipping_amount, status, marketplace,
           document_type, has_invoice, delivery_date, invoice_uploaded,
           return_status, company_rut, billing_city
         )
         VALUES ($1, 0, $2, $3, $4, 'boleta', false, $5, false,
                 'sin_devolucion', NULL, NULL)
         RETURNING id`,
        [
          order.orderId,
          order.shippingAmount,
          order.status,
          MARKETPLACES.WALMART,
          order.deliveryDate?.trim() || null,
        ],
      );
      orderHeaderId = insertedHeader.rows[0].id;
    }

    for (const item of order.items) {
      let existingDetail = await client.query(
        `SELECT id, status, marketplace_status
         FROM order_detail
         WHERE id_order_header = $1 AND marketplace_item_id = $2
         FOR UPDATE`,
        [orderHeaderId, item.marketplaceItemId],
      );

      // Migra sin duplicar las filas creadas por el flujo Walmart anterior,
      // que no guardaba marketplace_item_id.
      if ((existingDetail.rowCount ?? 0) === 0) {
        existingDetail = await client.query(
          `SELECT id, status, marketplace_status
           FROM order_detail
           WHERE id_order_header = $1
             AND marketplace_item_id IS NULL
             AND product_title = $2
           ORDER BY created_at ASC
           LIMIT 1
           FOR UPDATE`,
          [orderHeaderId, item.productTitle],
        );
      }

      if ((existingDetail.rowCount ?? 0) > 0) {
        const detail = existingDetail.rows[0];
        const resolvedStatus = resolveOrderItemStatusTransition(
          detail.status as StandardOrderItemStatus | null,
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
               status_updated_at = NOW(),
               updated_at = NOW()
           WHERE id = $7`,
          [
            item.marketplaceItemId,
            item.productTitle,
            item.productQuantity,
            item.productPrice,
            resolvedStatus,
            item.marketplaceStatus,
            detail.id,
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

    const synchronizedTitles = Array.from(
      new Set(order.items.map((item) => item.productTitle)),
    );
    if (synchronizedTitles.length > 0) {
      await client.query(
        `DELETE FROM order_detail
         WHERE id_order_header = $1
           AND marketplace_item_id IS NULL
           AND product_title = ANY($2::text[])`,
        [orderHeaderId, synchronizedTitles],
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
       SET return_status = $1::varchar,
           return_updated_at = NOW(),
           status = CASE
             WHEN $1::varchar = 'devolucion_total'::varchar THEN 'devuelto'
             ELSE status
           END,
           updated_at = NOW()
       WHERE id = $2`,
      [returnStatus, orderHeaderId],
    );

    await client.query('COMMIT');
    return { success: true, repeated, orderHeaderId, returnStatus };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al sincronizar orden de Walmart:', error);
    return { error: 'Error al sincronizar orden de Walmart' };
  } finally {
    client.release();
  }
}

export async function getActiveWalmartOrderIds(): Promise<string[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT order_id
       FROM order_header
       WHERE marketplace = $1
         AND status IN ('pendiente', 'enviado')
       ORDER BY updated_at ASC`,
      [MARKETPLACES.WALMART],
    );
    return result.rows
      .map((row: { order_id: unknown }) => String(row.order_id ?? '').trim())
      .filter(Boolean);
  } finally {
    client.release();
  }
}
