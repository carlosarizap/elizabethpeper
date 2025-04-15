import pool from '@/app/lib/db';
import { unstable_noStore as noStore } from 'next/cache';

// Optional pagination constant
const ITEMS_PER_PAGE = 50;

export async function fetchOrders(page: number = 1, query: string = '') {
  noStore();
  try {
    const offset = (page - 1) * ITEMS_PER_PAGE;
    const client = await pool.connect();

    const result = await client.query<Order>(
      `SELECT 
        id,
        order_id,
        total_amount,
        status,
        product_title,
        product_quantity,
        marketplace,
        delivery_date
      FROM orders
      WHERE 
        (product_title ILIKE $1 OR
        status ILIKE $1 OR
        order_id::TEXT ILIKE $1) AND
        delivery_date::date >= (
          CASE 
            WHEN CURRENT_TIME >= TIME '18:00'
            THEN CURRENT_DATE + 1
            ELSE CURRENT_DATE
          END
        )
      ORDER BY 
        CASE 
          WHEN marketplace = 'mercado_libre' THEN 1
          WHEN marketplace = 'falabella' THEN 2
          WHEN marketplace = 'ripley' THEN 3
          WHEN marketplace = 'paris' THEN 4
          ELSE 5
        END,
        delivery_date ASC
      LIMIT $2 OFFSET $3`,
      [`%${query}%`, ITEMS_PER_PAGE, offset]
    );

    // Agrupar rellenos
    const rellenos: Record<string, number> = {};

    for (const order of result.rows) {
      const title = order.product_title.toLowerCase();

      if (title.includes("relleno")) {
        const match = title.match(/(\d{2}x\d{2})/); // Ej: 45x45, 50x50

        if (match) {
          const medida = match[1]; // Ej: "50x50"
          if (!rellenos[medida]) rellenos[medida] = 0;
          rellenos[medida] += order.product_quantity;
        }
      }
    }


    client.release();
    return { orders: result.rows, rellenos };

  } catch (error) {
    console.error('Database Error fetching orders:', error);
    throw new Error('Failed to fetch orders.');
  }
}

export async function fetchOrderById(id: string) {
  noStore();
  try {
    const client = await pool.connect();

    const result = await client.query<Order>(
      `SELECT 
        id,
        order_id,
        total_amount,
        status,
        product_title,
        product_quantity,
        marketplace,
        delivery_date
      FROM orders
      WHERE id = $1`,
      [id]
    );

    client.release();
    return result.rows[0];
  } catch (error) {
    console.error('Database Error fetching order by ID:', error);
    throw new Error('Failed to fetch order.');
  }
}