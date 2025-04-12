'use server';

import pool from '@/app/lib/db';

export async function createOrder(order: {
  orderId: string;
  totalAmount: number;
  status: string;
  marketplace?: string;
  productTitle: string;
  productQuantity: number;
  deliveryDate?: string; 
}) {
  try {
    const client = await pool.connect();

    const exists = await client.query(
      'SELECT 1 FROM orders WHERE order_id = $1',
      [order.orderId]
    );

    if ((exists.rowCount ?? 0) > 0) {
      client.release();
      return { message: 'Orden ya existe' };
    }

    const insert = await client.query(
      `
      INSERT INTO orders (
        order_id, 
        total_amount, 
        status, 
        marketplace, 
        product_title, 
        product_quantity, 
        delivery_date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
      [
        order.orderId,
        order.totalAmount,
        order.status,
        order.marketplace ?? 'mercado_libre',
        order.productTitle,
        order.productQuantity,
        order.deliveryDate ?? null, // puede ser null si no hay fecha
      ]
    );

    client.release();
    return insert.rows[0];
  } catch (error) {
    console.error('Error al crear orden:', error);
    return { error: 'Error al crear orden' };
  }
}
