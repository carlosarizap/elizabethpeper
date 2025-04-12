import pool from '@/app/lib/db';
import { unstable_noStore as noStore } from 'next/cache';

// Optional pagination constant
const ITEMS_PER_PAGE = 20;

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
        product_title ILIKE $1 OR
        status ILIKE $1 OR
        order_id::TEXT ILIKE $1
      ORDER BY delivery_date ASC
      LIMIT $2 OFFSET $3`,
      [`%${query}%`, ITEMS_PER_PAGE, offset]
    );

    client.release();
    return result.rows;
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