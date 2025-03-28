import { createOrder } from "@/app/lib/actions/order-actions";
import { MARKETPLACES } from "@/app/lib/constants/marketplaces";
import { NextResponse } from "next/server";

export async function GET() {
    const token = process.env.MERCADO_LIBRE_ACCESS_TOKEN;
    const seller_id = process.env.MERCADO_LIBRE_SELLER_ID;
  
    if (!token) {
      return NextResponse.json({ error: "Falta token" }, { status: 400 });
    }
  
    try {
      console.log("Realizando solicitud a Mercado Libre...");
  
      const response = await fetch(
        `https://api.mercadolibre.com/orders/search?seller=${seller_id}&sort=date_desc&limit=1&offset=3`,
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
  
      // Procesar cada orden individualmente
      const insertedOrders = [];
  
      for (const order of orders) {
        const item = order.order_items?.[0]?.item;
        const quantity = order.order_items?.[0]?.quantity;
      
        const result = await createOrder({
          orderId: order.id.toString(),
          totalAmount: order.total_amount,
          status: order.status,
          marketplace: MARKETPLACES.MERCADO_LIBRE,
          productTitle: item?.title ?? 'Sin título',
          productQuantity: quantity ?? 1,
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