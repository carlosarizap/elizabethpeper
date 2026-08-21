import pool from '@/app/lib/db';
import { unstable_noStore as noStore } from 'next/cache';
import { OrderHeader } from '../definitions/order_header';

const ITEMS_PER_PAGE = 150;
const ORDERS_VIEW_LIMIT = 300;
const DASHBOARD_MONTH_FILTER = `
  (oh.created_at AT TIME ZONE 'America/Santiago')::date >= make_date($1, $2, 1)
  AND (oh.created_at AT TIME ZONE 'America/Santiago')::date <
    (make_date($1, $2, 1) + INTERVAL '1 month')::date
`;

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
  noStore();
  const client = await pool.connect();

  try {
    const chileDateParts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Santiago',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      })
        .formatToParts(new Date())
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    ) as Record<'year' | 'month' | 'day', number>;
    const daysInSelectedMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const isCurrentMonth =
      chileDateParts.year === year && chileDateParts.month === month;
    const comparisonDays = isCurrentMonth
      ? Math.min(chileDateParts.day, daysInSelectedMonth)
      : daysInSelectedMonth;
    const previousMonthDate = new Date(Date.UTC(year, month - 2, 1));
    const previousYear = previousMonthDate.getUTCFullYear();
    const previousMonth = previousMonthDate.getUTCMonth() + 1;

    const [
      marketplacesQuery,
      previousMarketplacesQuery,
      topProductsQuery,
      rellenosQuery,
      dailySalesQuery,
      summaryQuery,
      returnsByMarketplaceQuery,
      returnedProductsQuery,
      statusDistributionQuery,
      documentsQuery,
    ] = await Promise.all([
        client.query(`
          SELECT
            oh.marketplace,
            COALESCE(SUM(oh.total_amount), 0) AS total_ventas,
            COUNT(*) AS total_ordenes
          FROM order_header oh
          WHERE ${DASHBOARD_MONTH_FILTER}
            AND COALESCE(oh.status, '') <> 'cancelado'
          GROUP BY oh.marketplace
          ORDER BY total_ventas DESC
        `, [year, month]),
        client.query(`
          SELECT
            oh.marketplace,
            COALESCE(SUM(oh.total_amount), 0) AS total_ventas
          FROM order_header oh
          WHERE (oh.created_at AT TIME ZONE 'America/Santiago')::date >=
              make_date($1, $2, 1)
            AND (oh.created_at AT TIME ZONE 'America/Santiago')::date < LEAST(
              (make_date($1, $2, 1) + INTERVAL '1 month')::date,
              (make_date($1, $2, 1) + ($3 * INTERVAL '1 day'))::date
            )
            AND COALESCE(oh.status, '') <> 'cancelado'
          GROUP BY oh.marketplace
        `, [previousYear, previousMonth, comparisonDays]),
        client.query(`
          SELECT
            od.product_title,
            COALESCE(SUM(od.product_quantity), 0) AS cantidad_total
          FROM order_detail od
          JOIN order_header oh ON od.id_order_header = oh.id
          WHERE ${DASHBOARD_MONTH_FILTER}
            AND COALESCE(oh.status, '') <> 'cancelado'
          GROUP BY od.product_title
          ORDER BY cantidad_total DESC
          LIMIT 5
        `, [year, month]),
        client.query(`
          SELECT
            REGEXP_MATCHES(LOWER(od.product_title), '(\\d{2,3}x\\d{2,3})') AS medida,
            COALESCE(SUM(od.product_quantity), 0) AS cantidad
          FROM order_detail od
          JOIN order_header oh ON od.id_order_header = oh.id
          WHERE LOWER(od.product_title) LIKE '%relleno%'
            AND ${DASHBOARD_MONTH_FILTER}
            AND COALESCE(oh.status, '') <> 'cancelado'
          GROUP BY medida
          ORDER BY cantidad DESC
        `, [year, month]),
        client.query(`
          WITH days AS (
            SELECT generate_series(
              make_date($1, $2, 1),
              (make_date($1, $2, 1) + INTERVAL '1 month - 1 day')::date,
              INTERVAL '1 day'
            )::date AS sale_day
          )
          SELECT
            EXTRACT(DAY FROM days.sale_day)::int AS day,
            COALESCE(SUM(oh.total_amount), 0) AS total_ventas,
            COUNT(oh.id) AS total_ordenes
          FROM days
          LEFT JOIN order_header oh
            ON (oh.created_at AT TIME ZONE 'America/Santiago')::date = days.sale_day
            AND COALESCE(oh.status, '') <> 'cancelado'
          GROUP BY days.sale_day
          ORDER BY days.sale_day
        `, [year, month]),
        client.query(`
          WITH month_orders AS (
            SELECT oh.*
            FROM order_header oh
            WHERE ${DASHBOARD_MONTH_FILTER}
          ), returned_details AS (
            SELECT
              od.id_order_header,
              COALESCE(SUM(od.product_quantity), 0) AS unidades_vendidas,
              COALESCE(SUM(
                CASE WHEN od.status = 'devuelto'
                  THEN od.product_quantity
                  ELSE 0
                END
              ), 0) AS unidades_devueltas,
              COALESCE(SUM(
                CASE WHEN od.status = 'devuelto'
                  THEN od.product_quantity * od.product_price
                  ELSE 0
                END
              ), 0) AS monto_productos_devueltos
            FROM order_detail od
            JOIN month_orders mo ON mo.id = od.id_order_header
            WHERE COALESCE(mo.status, '') <> 'cancelado'
            GROUP BY od.id_order_header
          ), enriched_orders AS (
            SELECT
              mo.*,
              COALESCE(rd.unidades_vendidas, 0) AS unidades_vendidas,
              COALESCE(rd.unidades_devueltas, 0) AS unidades_devueltas,
              COALESCE(rd.monto_productos_devueltos, 0) AS monto_productos_devueltos
            FROM month_orders mo
            LEFT JOIN returned_details rd ON rd.id_order_header = mo.id
          )
          SELECT
            COALESCE(SUM(total_amount) FILTER (
              WHERE COALESCE(status, '') <> 'cancelado'
            ), 0) AS total_ventas,
            COUNT(*) FILTER (
              WHERE COALESCE(status, '') <> 'cancelado'
            ) AS total_ordenes,
            COALESCE(AVG(total_amount) FILTER (
              WHERE COALESCE(status, '') <> 'cancelado'
            ), 0) AS ticket_promedio,
            COALESCE(SUM(unidades_vendidas), 0) AS unidades_vendidas,
            COUNT(*) FILTER (
              WHERE COALESCE(status, '') <> 'cancelado'
                AND (
                  return_status IN ('devolucion_parcial', 'devolucion_total')
                  OR status = 'devuelto'
                )
            ) AS ordenes_devueltas,
            COALESCE(SUM(
              CASE
                WHEN status = 'cancelado' THEN 0
                WHEN return_status = 'devolucion_parcial'
                  THEN monto_productos_devueltos
                WHEN return_status = 'devolucion_total' OR status = 'devuelto'
                  THEN total_amount
                ELSE 0
              END
            ), 0) AS monto_devuelto,
            COALESCE(SUM(unidades_devueltas), 0) AS unidades_devueltas,
            COUNT(*) FILTER (WHERE status = 'cancelado') AS ordenes_canceladas,
            COALESCE(SUM(total_amount) FILTER (WHERE status = 'cancelado'), 0)
              AS monto_cancelado
          FROM enriched_orders
        `, [year, month]),
        client.query(`
          WITH month_orders AS (
            SELECT oh.*
            FROM order_header oh
            WHERE ${DASHBOARD_MONTH_FILTER}
              AND COALESCE(oh.status, '') <> 'cancelado'
          ), detail_returns AS (
            SELECT
              od.id_order_header,
              COALESCE(SUM(
                CASE WHEN od.status = 'devuelto' THEN od.product_quantity ELSE 0 END
              ), 0) AS unidades_devueltas,
              COALESCE(SUM(
                CASE WHEN od.status = 'devuelto'
                  THEN od.product_quantity * od.product_price
                  ELSE 0
                END
              ), 0) AS monto_productos_devueltos
            FROM order_detail od
            JOIN month_orders mo ON mo.id = od.id_order_header
            GROUP BY od.id_order_header
          ), enriched_orders AS (
            SELECT
              mo.*,
              COALESCE(dr.unidades_devueltas, 0) AS unidades_devueltas,
              COALESCE(dr.monto_productos_devueltos, 0) AS monto_productos_devueltos
            FROM month_orders mo
            LEFT JOIN detail_returns dr ON dr.id_order_header = mo.id
          )
          SELECT
            marketplace,
            COUNT(*) FILTER (
              WHERE return_status IN ('devolucion_parcial', 'devolucion_total')
                 OR status = 'devuelto'
            ) AS ordenes_devueltas,
            COALESCE(SUM(unidades_devueltas), 0) AS unidades_devueltas,
            COALESCE(SUM(
              CASE
                WHEN return_status = 'devolucion_parcial'
                  THEN monto_productos_devueltos
                WHEN return_status = 'devolucion_total' OR status = 'devuelto'
                  THEN total_amount
                ELSE 0
              END
            ), 0) AS monto_devuelto
          FROM enriched_orders
          GROUP BY marketplace
          HAVING COUNT(*) FILTER (
            WHERE return_status IN ('devolucion_parcial', 'devolucion_total')
               OR status = 'devuelto'
          ) > 0
          ORDER BY monto_devuelto DESC
        `, [year, month]),
        client.query(`
          SELECT
            od.product_title,
            COALESCE(SUM(od.product_quantity), 0) AS cantidad_devuelta,
            COALESCE(SUM(od.product_quantity * od.product_price), 0) AS monto_devuelto
          FROM order_detail od
          JOIN order_header oh ON oh.id = od.id_order_header
          WHERE ${DASHBOARD_MONTH_FILTER}
            AND COALESCE(oh.status, '') <> 'cancelado'
            AND od.status = 'devuelto'
          GROUP BY od.product_title
          ORDER BY cantidad_devuelta DESC, monto_devuelto DESC
          LIMIT 5
        `, [year, month]),
        client.query(`
          SELECT
            COALESCE(NULLIF(oh.status, ''), 'pendiente') AS status,
            COUNT(*) AS total
          FROM order_header oh
          WHERE ${DASHBOARD_MONTH_FILTER}
          GROUP BY COALESCE(NULLIF(oh.status, ''), 'pendiente')
        `, [year, month]),
        client.query(`
          SELECT
            COUNT(*) FILTER (
              WHERE oh.has_invoice = false
                AND oh.document_type IN ('boleta', 'factura')
                AND oh.status IN ('pendiente', 'enviado', 'recibido')
                AND COALESCE(oh.return_status, 'sin_devolucion') = 'sin_devolucion'
            ) AS documentos_pendientes,
            COUNT(*) FILTER (
              WHERE oh.has_invoice = false
                AND oh.document_type = 'boleta'
                AND oh.status IN ('pendiente', 'enviado', 'recibido')
                AND COALESCE(oh.return_status, 'sin_devolucion') = 'sin_devolucion'
            ) AS boletas_pendientes,
            COUNT(*) FILTER (
              WHERE oh.has_invoice = false
                AND oh.document_type = 'factura'
                AND oh.status IN ('pendiente', 'enviado', 'recibido')
                AND COALESCE(oh.return_status, 'sin_devolucion') = 'sin_devolucion'
            ) AS facturas_pendientes,
            COUNT(*) FILTER (
              WHERE oh.has_invoice = true
                AND oh.document_type = 'boleta'
                AND COALESCE(oh.has_credit_note, false) = false
                AND oh.sii_folio IS NOT NULL
                AND oh.sii_issued_at IS NOT NULL
                AND EXISTS (
                  SELECT 1
                  FROM order_detail od
                  WHERE od.id_order_header = oh.id
                    AND od.status IN ('devuelto', 'cancelado')
                )
            ) AS notas_credito_pendientes
          FROM order_header oh
          WHERE ${DASHBOARD_MONTH_FILTER}
        `, [year, month]),
      ]);

    // Mapear rellenos a objeto clave-valor
    const rellenos: Record<string, number> = {};
    for (const row of rellenosQuery.rows) {
      const medida = row.medida?.[0]; // REGEXP_MATCHES devuelve array
      if (medida) {
        rellenos[medida] = Number(row.cantidad);
      }
    }

    const summaryRow = summaryQuery.rows[0];
    const totalVentas = Number(summaryRow.total_ventas);
    const totalOrdenes = Number(summaryRow.total_ordenes);
    const montoDevuelto = Number(summaryRow.monto_devuelto);
    const ordenesDevueltas = Number(summaryRow.ordenes_devueltas);
    const ordenesCanceladas = Number(summaryRow.ordenes_canceladas);
    const unidadesVendidas = Number(summaryRow.unidades_vendidas);
    const unidadesDevueltas = Number(summaryRow.unidades_devueltas);
    const previousSalesByMarketplace = new Map<string, number>(
      previousMarketplacesQuery.rows.map((row) => [
        row.marketplace,
        Number(row.total_ventas),
      ]),
    );
    const currentSalesByMarketplace = new Map<string, {
      total_ventas: number;
      total_ordenes: number;
    }>(
      marketplacesQuery.rows.map((row) => [
        row.marketplace,
        {
          total_ventas: Number(row.total_ventas),
          total_ordenes: Number(row.total_ordenes),
        },
      ]),
    );
    const marketplaceNames = new Set([
      ...currentSalesByMarketplace.keys(),
      ...previousSalesByMarketplace.keys(),
    ]);
    const previousTotalSales = Array.from(previousSalesByMarketplace.values())
      .reduce((sum, value) => sum + value, 0);
    const monthlyGrowth = previousTotalSales > 0
      ? ((totalVentas - previousTotalSales) / previousTotalSales) * 100
      : null;
    const elapsedDays = isCurrentMonth ? comparisonDays : daysInSelectedMonth;
    const projectedSales = isCurrentMonth && elapsedDays < daysInSelectedMonth
      ? (totalVentas / Math.max(elapsedDays, 1)) * daysInSelectedMonth
      : totalVentas;
    const statusRows = statusDistributionQuery.rows.map((row) => ({
      status: row.status,
      total: Number(row.total),
    }));
    const registeredOrders = statusRows.reduce((sum, row) => sum + row.total, 0);
    const documentsRow = documentsQuery.rows[0];

    return {
      marketplaces: Array.from(marketplaceNames)
        .map((marketplace) => {
          const current = currentSalesByMarketplace.get(marketplace) ?? {
            total_ventas: 0,
            total_ordenes: 0,
          };
          const previousSales = previousSalesByMarketplace.get(marketplace) ?? 0;

          return {
            marketplace,
            total_ventas: current.total_ventas,
            total_ordenes: current.total_ordenes,
            participacion:
              totalVentas > 0 ? (current.total_ventas / totalVentas) * 100 : 0,
            ventas_mes_anterior: previousSales,
            crecimiento:
              previousSales > 0
                ? ((current.total_ventas - previousSales) / previousSales) * 100
                : null,
          };
        })
        .sort((a, b) => b.total_ventas - a.total_ventas),
      topProducts: topProductsQuery.rows.map((row) => ({
        product_title: row.product_title,
        cantidad_total: Number(row.cantidad_total),
      })),
      rellenos,
      dailySales: dailySalesQuery.rows.map((row) => ({
        day: Number(row.day),
        total_ventas: Number(row.total_ventas),
        total_ordenes: Number(row.total_ordenes),
      })),
      summary: {
        total_ventas: totalVentas,
        ventas_netas: Math.max(totalVentas - montoDevuelto, 0),
        ventas_mes_anterior: previousTotalSales,
        crecimiento_mensual: monthlyGrowth,
        proyeccion_cierre: projectedSales,
        es_proyeccion: isCurrentMonth && elapsedDays < daysInSelectedMonth,
        total_ordenes: totalOrdenes,
        ticket_promedio: Number(summaryRow.ticket_promedio),
        unidades_vendidas: unidadesVendidas,
        monto_devuelto: montoDevuelto,
        ordenes_devueltas: ordenesDevueltas,
        unidades_devueltas: unidadesDevueltas,
        tasa_devolucion: totalVentas > 0 ? (montoDevuelto / totalVentas) * 100 : 0,
        tasa_unidades_devueltas:
          unidadesVendidas > 0 ? (unidadesDevueltas / unidadesVendidas) * 100 : 0,
        monto_cancelado: Number(summaryRow.monto_cancelado),
        ordenes_canceladas: ordenesCanceladas,
        tasa_cancelacion:
          totalOrdenes + ordenesCanceladas > 0
            ? (ordenesCanceladas / (totalOrdenes + ordenesCanceladas)) * 100
            : 0,
      },
      returnsByMarketplace: returnsByMarketplaceQuery.rows.map((row) => {
        const marketplaceSales =
          currentSalesByMarketplace.get(row.marketplace)?.total_ventas ?? 0;
        const returnedAmount = Number(row.monto_devuelto);

        return {
          marketplace: row.marketplace,
          monto_devuelto: returnedAmount,
          ordenes_devueltas: Number(row.ordenes_devueltas),
          unidades_devueltas: Number(row.unidades_devueltas),
          tasa_devolucion:
            marketplaceSales > 0 ? (returnedAmount / marketplaceSales) * 100 : 0,
        };
      }),
      returnedProducts: returnedProductsQuery.rows.map((row) => ({
        product_title: row.product_title,
        cantidad_devuelta: Number(row.cantidad_devuelta),
        monto_devuelto: Number(row.monto_devuelto),
      })),
      statusDistribution: statusRows
        .map((row) => ({
          ...row,
          porcentaje: registeredOrders > 0 ? (row.total / registeredOrders) * 100 : 0,
        }))
        .sort((a, b) => b.total - a.total),
      documents: {
        documentos_pendientes: Number(documentsRow.documentos_pendientes),
        boletas_pendientes: Number(documentsRow.boletas_pendientes),
        facturas_pendientes: Number(documentsRow.facturas_pendientes),
        notas_credito_pendientes: Number(documentsRow.notas_credito_pendientes),
      },
    };
  } catch (error) {
    console.error('Error fetching stats by month:', error);
    throw new Error('Failed to fetch stats by month');
  } finally {
    client.release();
  }
}
