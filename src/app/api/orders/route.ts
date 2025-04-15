process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { NextResponse } from 'next/server';
import { fetchOrders } from '@/app/lib/data/order-data'; // o donde tengas ese método

export async function GET() {
  try {
    const orders = await fetchOrders(); // puedes añadir page/query si gustas
    return NextResponse.json(orders);
  } catch (error) {
    console.error("Error", error);
    return NextResponse.json({ error: 'Error al cargar órdenes' }, { status: 500 });
  }
}
