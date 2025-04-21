process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { createOrder } from "@/app/lib/actions/order-actions";
import { MARKETPLACES } from "@/app/lib/constants/marketplaces";
import { NextResponse } from "next/server";

function calcularFechaEntrega(dateCreated: string): string {
  const fecha = new Date(dateCreated);
  const hora = fecha.getHours();
  const diasASumar = hora >= 18 ? 2 : 1;

  fecha.setDate(fecha.getDate() + diasASumar);

  const diaEntrega = fecha.getDay();
  if (diaEntrega === 6) {
    fecha.setDate(fecha.getDate() + 2);
  } else if (diaEntrega === 0) {
    fecha.setDate(fecha.getDate() + 1);
  }

  return fecha.toISOString();
}

function getFechaHaceDias(dias: number) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - dias);
  return fecha.toISOString().split(".")[0]; // yyyy-MM-ddTHH:mm:ss
}

export async function GET() {
  const apiKey = process.env.RIPLEY_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: "Falta API Key" }, { status: 400 });
  }

  try {
    const startDate = getFechaHaceDias(7);
    const endDate = new Date().toISOString().split(".")[0];

    const response = await fetch(
      `https://ripley-prod.mirakl.net/api/orders?start_update_date=${startDate}&end_update_date=${endDate}&paginate=false`,
      {
        headers: {
          Accept: "application/json",
          Authorization: apiKey,
        },
      }
    );

    const data = await response.json();
    const orders = data.orders || [];

    const insertedOrders = [];

    for (const order of orders) {
      for (const line of order.order_lines) {
        const deliveryDate = calcularFechaEntrega(order.created_date);

        const result = await createOrder({
          orderId: `${order.order_id}-${line.order_line_id}`,
          totalAmount: line.total_price,
          status: line.order_line_state,
          marketplace: MARKETPLACES.RIPLEY,
          productTitle: line.product_title ?? "Sin título",
          productQuantity: line.quantity ?? 1,
          deliveryDate,
        });

        insertedOrders.push(result);
      }
    }

    return NextResponse.json({ inserted: insertedOrders });
  } catch (error) {
    console.error("Error en la API de Ripley:", error);
    return NextResponse.json({ error: "Error en la API de Ripley" }, { status: 500 });
  }
}