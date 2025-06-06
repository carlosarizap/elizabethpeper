'use server';

import pool from '@/app/lib/db';
import { MARKETPLACES } from '../constants/marketplaces';

export async function createOrder(order: {
  orderId: string;
  shippingAmount?: number;
  status: string;
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
      'SELECT id FROM order_header WHERE order_id = $1',
      [order.orderId]
    );

    let orderHeaderId: string;

    if ((exists.rowCount ?? 0) > 0) {
      orderHeaderId = exists.rows[0].id;

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
