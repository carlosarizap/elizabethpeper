process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { createOrder } from "@/app/lib/actions/order-actions";
import { MARKETPLACES } from "@/app/lib/constants/marketplaces";
import { getValidAccessToken } from "@/app/lib/mercadolibre/token-manager";
import { NextResponse } from "next/server";

export async function GET() {
  const seller_id = process.env.MERCADO_LIBRE_SELLER_ID;
  const token = await getValidAccessToken();

  if (!token) {
    return NextResponse.json({ error: "Falta token" }, { status: 400 });
  }

  try {
    console.log("Realizando solicitud a Mercado Libre...");

    const response = await fetch(
      `https://api.mercadolibre.com/orders/search?seller=${seller_id}&sort=date_desc&limit=30`,
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
      if (order.status !== "paid") continue;

      const item = order.order_items?.[0]?.item;
      const quantity = order.order_items?.[0]?.quantity;
      const shipmentId = order?.shipping?.id;

      let slaFechaEntrega = null;

      if (shipmentId) {
        try {
          const slaResponse = await fetch(`https://api.mercadolibre.com/shipments/${shipmentId}`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (slaResponse.ok) {
            const slaData = await slaResponse.json();
            slaFechaEntrega = slaData?.shipping_option?.estimated_handling_limit?.date || null;
          }
        } catch (err) {
          console.warn("No se pudo obtener fecha SLA para shipping", err);
        }
      }
      

      const result = await createOrder({
        orderId: order.id.toString(),
        totalAmount: order.total_amount,
        status: order.status,
        marketplace: MARKETPLACES.MERCADO_LIBRE,
        productTitle: item?.title ?? "Sin título",
        productQuantity: quantity ?? 1,
        deliveryDate: slaFechaEntrega, // 🎯 usamos la fecha de SLA
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