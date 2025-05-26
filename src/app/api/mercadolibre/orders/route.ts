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
      `https://api.mercadolibre.com/orders/search?seller=${seller_id}&sort=date_desc&limit=20`,
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

      const orderOrPackId = order.pack_id ? order.pack_id.toString() : order.id.toString(); // ⚡️ Prioridad pack_id
      const shipmentId = order?.shipping?.id;
      let slaFechaEntrega = null;
      if (shipmentId) {
        try {
          const slaResponse = await fetch(`https://api.mercadolibre.com/shipments/${shipmentId}/sla`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (slaResponse.ok) {
            const slaData = await slaResponse.json();
            slaFechaEntrega = slaData?.expected_date ?? null;
          }
        } catch (err) {
          console.warn("No se pudo obtener fecha SLA para shipping", err);
        }
      }

      for (const item of order.order_items ?? []) {
        const productTitle = item?.item?.title ?? "Sin título";
        const quantity = item?.quantity ?? 1;
        const unitPrice = item?.unit_price ?? 0;

        const result = await createOrder({
          orderId: orderOrPackId,
          shippingAmount: 0,
          status: order.status,
          marketplace: MARKETPLACES.MERCADO_LIBRE,
          documentType: "boleta",
          productTitle,
          productQuantity: quantity,
          productPrice: unitPrice,
          deliveryDate: slaFechaEntrega,
        });

        insertedOrders.push(result);
      }
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
