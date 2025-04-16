import { createOrder } from "@/app/lib/actions/order-actions";
import { MARKETPLACES } from "@/app/lib/constants/marketplaces";
import { getValidAccessToken } from "@/app/lib/mercadolibre/token-manager";
import { NextResponse } from "next/server";

function calcularFechaEntrega(dateCreated: string): string {
  const fecha = new Date(dateCreated);
  const hora = fecha.getHours();
  const diasASumar = hora >= 18 ? 2 : 1;

  // Sumar días base
  fecha.setDate(fecha.getDate() + diasASumar);

  // Verificar si la fecha resultante cae en fin de semana
  const diaEntrega = fecha.getDay(); // 0 = domingo, 6 = sábado

  if (diaEntrega === 6) {
    // Sábado → entregar lunes
    fecha.setDate(fecha.getDate() + 2);
  } else if (diaEntrega === 0) {
    // Domingo → entregar lunes
    fecha.setDate(fecha.getDate() + 1);
  }

  return fecha.toISOString();
}

export async function GET() {
  const seller_id = process.env.MERCADO_LIBRE_SELLER_ID;

  const token = await getValidAccessToken();

  if (!token) {
    return NextResponse.json({ error: "Falta token" }, { status: 400 });
  }

  try {
    console.log("Realizando solicitud a Mercado Libre...");

    const response = await fetch(
      `https://api.mercadolibre.com/orders/search?seller=${seller_id}&sort=date_desc&limit=50`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error en la API de Mercado Libre:", errorText);
      return NextResponse.json({ error: errorText }, { status: response.status });
    }

    const data = await response.json();
    const orders = data.results;

    if (!orders || orders.length === 0) {
      return NextResponse.json({ error: "No se encontraron órdenes" }, { status: 404 });
    }

    const insertedOrders = [];

    for (const order of orders) {
      if (order.status !== "paid") {
        continue;
      }

      const item = order.order_items?.[0]?.item;
      const quantity = order.order_items?.[0]?.quantity;

      const deliveryDate = calcularFechaEntrega(order.date_created);

      const result = await createOrder({
        orderId: order.id.toString(),
        totalAmount: order.total_amount,
        status: order.status,
        marketplace: MARKETPLACES.MERCADO_LIBRE,
        productTitle: item?.title ?? "Sin título",
        productQuantity: quantity ?? 1,
        deliveryDate,
      });

      insertedOrders.push(result);
    }

    return NextResponse.json({ inserted: insertedOrders });
  } catch (error) {
    console.error("Error en la API:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 }
    );
  }
}
