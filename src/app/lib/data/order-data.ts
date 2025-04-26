import pool from '@/app/lib/db';
import { unstable_noStore as noStore } from 'next/cache';
import { OrderHeader } from '../definitions/order_header';

const ITEMS_PER_PAGE = 50;

export async function fetchOrders(page: number = 1, query: string = '') {
  noStore();
  try {
    const offset = (page - 1) * ITEMS_PER_PAGE;
    const client = await pool.connect();

    const result = await client.query(
      `SELECT 
        oh.id AS id,
        oh.order_id,
        oh.total_amount,
        oh.shipping_amount,
        oh.document_type,
        oh.has_invoice,
        oh.invoice_pdf,
        oh.status,
        oh.marketplace,
        oh.delivery_date,
        oh.created_at AS header_created_at,
        oh.updated_at AS header_updated_at,
        od.id AS detail_id,
        od.product_title,
        od.product_quantity,
        od.product_price,
        od.created_at AS detail_created_at,
        od.updated_at AS detail_updated_at
      FROM order_header oh
      JOIN order_detail od ON oh.id = od.id_order_header
      WHERE 
        (od.product_title ILIKE $1 OR
         oh.status ILIKE $1 OR
         oh.order_id::TEXT ILIKE $1) AND
        oh.delivery_date::date >= (
          CASE 
            WHEN CURRENT_TIME >= TIME '18:00'
            THEN CURRENT_DATE + 1
            ELSE CURRENT_DATE
          END
        )
      ORDER BY 
        CASE 
          WHEN oh.marketplace = 'mercado_libre' THEN 1
          WHEN oh.marketplace = 'falabella' THEN 2
          WHEN oh.marketplace = 'ripley' THEN 3
          WHEN oh.marketplace = 'paris' THEN 4
          ELSE 5
        END,
        oh.delivery_date ASC
      LIMIT $2 OFFSET $3`,
      [`%${query}%`, ITEMS_PER_PAGE, offset]
    );

    const rellenos: Record<string, number> = {};
    const headersMap = new Map<string, OrderHeader>();

    for (const row of result.rows) {
      const title = row.product_title?.toLowerCase() || '';
      if (title.includes("relleno")) {
        const match = title.match(/(\d{2}x\d{2})/);
        if (match) {
          const medida = match[1];
          if (!rellenos[medida]) rellenos[medida] = 0;
          rellenos[medida] += row.product_quantity;
        }
      }

      if (!headersMap.has(row.id)) {
        headersMap.set(row.id, {
          id: row.id,
          order_id: row.order_id,
          total_amount: row.total_amount,
          shipping_amount: row.shipping_amount || 0,
          document_type: row.document_type || 'boleta',
          has_invoice: row.has_invoice || false,
          invoice_pdf: row.invoice_pdf || null,
          marketplace: row.marketplace,
          status: row.status,
          delivery_date: row.delivery_date,
          created_at: row.header_created_at,
          updated_at: row.header_updated_at,
          details: [],
        });
      }

      headersMap.get(row.id)?.details.push({
        id: row.detail_id,
        id_order_header: row.id,
        product_title: row.product_title,
        product_quantity: row.product_quantity,
        product_price: row.product_price,
        created_at: row.detail_created_at,
        updated_at: row.detail_updated_at,
      });
    }

    client.release();

    return {
      orders: Array.from(headersMap.values()),
      rellenos,
    };

  } catch (error) {
    console.error('Database Error fetching orders:', error);
    throw new Error('Failed to fetch orders.');
  }
}

export async function fetchOrderById(id: string) {
  noStore();
  try {
    const client = await pool.connect();

    const result = await client.query(
      `SELECT 
        oh.id AS id,
        oh.order_id,
        oh.total_amount,
        oh.status,
        od.product_title,
        od.product_quantity,
        od.product_price,
        oh.marketplace,
        oh.delivery_date
      FROM order_header oh
      JOIN order_detail od ON oh.id = od.id_order_header
      WHERE oh.id = $1`,
      [id]
    );

    client.release();
    return result.rows;

  } catch (error) {
    console.error('Database Error fetching order by ID:', error);
    throw new Error('Failed to fetch order.');
  }
}

export async function fetchAllOrders(page: number = 1, query: string = '') {
  noStore();
  try {
    const offset = (page - 1) * ITEMS_PER_PAGE;
    const client = await pool.connect();

    const result = await client.query(
      `SELECT 
        oh.id AS id,
        oh.order_id,
        oh.total_amount,
        oh.shipping_amount,
        oh.document_type,
        oh.has_invoice,
        oh.invoice_pdf,
        oh.status,
        oh.marketplace,
        oh.delivery_date,
        oh.created_at AS header_created_at,
        oh.updated_at AS header_updated_at,
        od.id AS detail_id,
        od.product_title,
        od.product_quantity,
        od.product_price,
        od.created_at AS detail_created_at,
        od.updated_at AS detail_updated_at
      FROM order_header oh
      JOIN order_detail od ON oh.id = od.id_order_header
      WHERE 
        (od.product_title ILIKE $1 OR
         oh.status ILIKE $1 OR
         oh.order_id::TEXT ILIKE $1) 
      ORDER BY 
        oh.created_at DESC
      LIMIT $2 OFFSET $3`,
      [`%${query}%`, ITEMS_PER_PAGE, offset]
    );

    const headersMap = new Map<string, OrderHeader>();

    for (const row of result.rows) {
      if (!headersMap.has(row.id)) {
        headersMap.set(row.id, {
          id: row.id,
          order_id: row.order_id,
          total_amount: row.total_amount,
          shipping_amount: row.shipping_amount || 0,
          document_type: row.document_type || 'boleta',
          has_invoice: row.has_invoice || false,
          invoice_pdf: row.invoice_pdf || null,
          marketplace: row.marketplace,
          status: row.status,
          delivery_date: row.delivery_date,
          created_at: row.header_created_at,
          updated_at: row.header_updated_at,
          details: [],
        });
      }

      headersMap.get(row.id)?.details.push({
        id: row.detail_id,
        id_order_header: row.id,
        product_title: row.product_title,
        product_quantity: row.product_quantity,
        product_price: row.product_price,
        created_at: row.detail_created_at,
        updated_at: row.detail_updated_at,
      });
    }

    client.release();

    return {
      orders: Array.from(headersMap.values()),
    };

  } catch (error) {
    console.error('Database Error fetching all orders:', error);
    throw new Error('Failed to fetch all orders.');
  }
}

export async function getOrderInvoiceById(orderId: string): Promise<Buffer | null> {
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT invoice_pdf FROM order_header WHERE id = $1 AND has_invoice = true`,
      [orderId]
    );

    if (result.rowCount === 0 || !result.rows[0].invoice_pdf) {
      return null;
    }

    return result.rows[0].invoice_pdf;
  } catch (error) {
    console.error('Error consultando invoice PDF:', error);
    throw new Error('Failed to fetch invoice.');
  } finally {
    client.release();
  }
}