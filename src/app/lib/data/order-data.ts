import pool from '@/app/lib/db';
import { unstable_noStore as noStore } from 'next/cache';
import { OrderHeader } from '../definitions/order_header';

const ITEMS_PER_PAGE = 150;
const ORDERS_VIEW_LIMIT = 300;

function appendGroupedDetail(
  order: OrderHeader,
  detail: OrderHeader['details'][number],
) {
  const existingDetail = order.details.find(
    (current) =>
      current.product_title.trim().toLowerCase() ===
        detail.product_title.trim().toLowerCase() &&
      Number(current.product_price) === Number(detail.product_price) &&
      current.status === detail.status &&
      current.marketplace_status === detail.marketplace_status,
  );

  if (existingDetail) {
    existingDetail.product_quantity += detail.product_quantity;
    return;
  }

  order.details.push(detail);
}

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
        oh.has_credit_note,
        oh.sii_folio,
        oh.sii_issued_at,
        oh.status,
        oh.return_status,
        oh.return_updated_at,
        oh.company_rut,
        oh.billing_city,
        oh.marketplace,
        oh.delivery_date,
        oh.created_at AS header_created_at,
        oh.updated_at AS header_updated_at,
        od.id AS detail_id,
        od.product_title,
        od.product_quantity,
        od.product_price,
        od.marketplace_item_id,
        od.marketplace_order_id,
        od.status AS detail_status,
        od.marketplace_status,
        od.status_updated_at,
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
          WHEN oh.marketplace = 'walmart' THEN 5
          ELSE 6
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
          has_credit_note: row.has_credit_note || false,
          sii_folio: row.sii_folio === null ? null : Number(row.sii_folio),
          sii_issued_at: row.sii_issued_at || null,
          marketplace: row.marketplace,
          status: row.status,
          return_status: row.return_status,
          return_updated_at: row.return_updated_at,
          company_rut: row.company_rut,
          billing_city: row.billing_city,
          delivery_date: row.delivery_date,
          created_at: row.header_created_at,
          updated_at: row.header_updated_at,
          details: [],
        });
      }

      const orderHeader = headersMap.get(row.id);
      if (orderHeader) appendGroupedDetail(orderHeader, {
        id: row.detail_id,
        id_order_header: row.id,
        product_title: row.product_title,
        product_quantity: row.product_quantity,
        product_price: row.product_price,
        marketplace_item_id: row.marketplace_item_id,
        marketplace_order_id: row.marketplace_order_id,
        status: row.detail_status,
        marketplace_status: row.marketplace_status,
        status_updated_at: row.status_updated_at,
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
        oh.return_status,
        oh.return_updated_at,
        oh.company_rut,
        oh.billing_city,
        od.product_title,
        od.product_quantity,
        od.product_price,
        od.marketplace_item_id,
        od.status AS detail_status,
        od.marketplace_status,
        od.status_updated_at,
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

export async function fetchAllOrders(
  page: number = 1,
  query: string = '',
  marketplace: string = '',
  documentType: string = '',
  deliveryDate: string = '',
  startDate: string = '',
  endDate: string = '',
  hasInvoice: string = ''
) {
  noStore();
  try {
    const offset = (page - 1) * ORDERS_VIEW_LIMIT;
    const client = await pool.connect();

    let filters: string[] = [];
    let params: any[] = [];

    if (query) {
      filters.push(`(oh.order_id::TEXT ILIKE $${params.length + 1} OR od.product_title ILIKE $${params.length + 1})`);
      params.push(`%${query}%`);
    }
    if (marketplace) {
      filters.push(`oh.marketplace = $${params.length + 1}`);
      params.push(marketplace);
    }
    if (documentType) {
      filters.push(`oh.document_type = $${params.length + 1}`);
      params.push(documentType);
    }
    if (deliveryDate) {
      filters.push(`oh.delivery_date::date = $${params.length + 1}`);
      params.push(deliveryDate);
    }
    if (startDate) {
      filters.push(`oh.created_at::date >= $${params.length + 1}`);
      params.push(startDate);
    }
    if (endDate) {
      filters.push(`oh.created_at::date <= $${params.length + 1}`);
      params.push(endDate);
    }
    if (hasInvoice) {
      filters.push(`oh.has_invoice = $${params.length + 1}`);
      params.push(hasInvoice === "true");
    }

    // Agrega LIMIT y OFFSET al final
    const limitParam = `$${params.length + 1}`;
    const offsetParam = `$${params.length + 2}`;
    params.push(ORDERS_VIEW_LIMIT, offset);

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const result = await client.query(
      `WITH selected_orders AS (
        SELECT oh.id, oh.created_at
        FROM order_header oh
        JOIN order_detail od ON oh.id = od.id_order_header
        ${whereClause}
        GROUP BY oh.id, oh.created_at
        ORDER BY oh.created_at DESC
        LIMIT ${limitParam} OFFSET ${offsetParam}
      )
      SELECT 
        oh.id AS id,
        oh.order_id,
        oh.total_amount,
        oh.shipping_amount,
        oh.document_type,
        oh.has_invoice,
        oh.invoice_pdf,
        oh.has_credit_note,
        oh.sii_folio,
        oh.sii_issued_at,
        oh.status,
        oh.marketplace,
        oh.delivery_date,
        oh.created_at AS header_created_at,
        oh.updated_at AS header_updated_at,
        od.id AS detail_id,
        od.product_title,
        od.product_quantity,
        od.product_price,
        od.marketplace_item_id,
        od.marketplace_order_id,
        od.status AS detail_status,
        od.marketplace_status,
        od.status_updated_at,
        od.created_at AS detail_created_at,
        od.updated_at AS detail_updated_at
      FROM selected_orders selected
      JOIN order_header oh ON oh.id = selected.id
      JOIN order_detail od ON oh.id = od.id_order_header
      ORDER BY oh.created_at DESC, od.id ASC`,
      params
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
          has_credit_note: row.has_credit_note || false,
          sii_folio: row.sii_folio === null ? null : Number(row.sii_folio),
          sii_issued_at: row.sii_issued_at || null,
          marketplace: row.marketplace,
          status: row.status,
          return_status: row.return_status,
          return_updated_at: row.return_updated_at,
          company_rut: row.company_rut,
          billing_city: row.billing_city,
          delivery_date: row.delivery_date,
          created_at: row.header_created_at,
          updated_at: row.header_updated_at,
          details: [],
        });
      }

      const orderHeader = headersMap.get(row.id);
      if (orderHeader) appendGroupedDetail(orderHeader, {
        id: row.detail_id,
        id_order_header: row.id,
        product_title: row.product_title,
        product_quantity: row.product_quantity,
        product_price: row.product_price,
        marketplace_item_id: row.marketplace_item_id,
        marketplace_order_id: row.marketplace_order_id,
        status: row.detail_status,
        marketplace_status: row.marketplace_status,
        status_updated_at: row.status_updated_at,
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

export async function fetchOrderStatsByMonth(year: number, month: number) {
  const client = await pool.connect();

  try {
    // Totales por marketplace
    const result = await client.query(`
      SELECT 
        oh.marketplace,
        SUM(oh.total_amount) AS total_ventas,
        COUNT(*) AS total_ordenes
      FROM order_header oh
      WHERE EXTRACT(YEAR FROM oh.created_at) = $1 AND EXTRACT(MONTH FROM oh.created_at) = $2
      GROUP BY oh.marketplace
    `, [year, month]);

    // Top 5 productos más vendidos
    const topProductsQuery = await client.query(`
      SELECT 
        od.product_title,
        SUM(od.product_quantity) AS cantidad_total
      FROM order_detail od
      JOIN order_header oh ON od.id_order_header = oh.id
      WHERE EXTRACT(YEAR FROM oh.created_at) = $1 AND EXTRACT(MONTH FROM oh.created_at) = $2
      GROUP BY od.product_title
      ORDER BY cantidad_total DESC
      LIMIT 5
    `, [year, month]);

    // Rellenos vendidos por medida (detecta medidas tipo 90x190, 150x200, etc.)
    const rellenosQuery = await client.query(`
      SELECT 
        REGEXP_MATCHES(LOWER(od.product_title), '(\\d{2,3}x\\d{2,3})') AS medida,
        SUM(od.product_quantity) AS cantidad
      FROM order_detail od
      JOIN order_header oh ON od.id_order_header = oh.id
      WHERE 
        EXTRACT(YEAR FROM oh.created_at) = $1 AND 
        EXTRACT(MONTH FROM oh.created_at) = $2 AND 
        LOWER(od.product_title) LIKE '%relleno%'
      GROUP BY medida
    `, [year, month]);

    // Mapear rellenos a objeto clave-valor
    const rellenos: Record<string, number> = {};
    for (const row of rellenosQuery.rows) {
      const medida = row.medida?.[0]; // REGEXP_MATCHES devuelve array
      if (medida) {
        rellenos[medida] = parseInt(row.cantidad);
      }
    }

    return {
      marketplaces: result.rows,
      topProducts: topProductsQuery.rows,
      rellenos,
    };
  } catch (error) {
    console.error('Error fetching stats by month:', error);
    throw new Error('Failed to fetch stats by month');
  } finally {
    client.release();
  }
}
