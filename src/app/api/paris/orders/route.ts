import { createOrder } from "@/app/lib/actions/order-actions";
import { MARKETPLACES } from "@/app/lib/constants/marketplaces";
import { NextResponse } from "next/server";

function getFechaHaceDias(dias: number) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - dias);
  return fecha.toISOString().split("T")[0]; // yyyy-MM-dd
}

export async function GET() {
  const accessToken = process.env.PARIS_ACCESS_TOKEN;
  const sellerId = process.env.PARIS_SELLER_ID;

  if (!accessToken || !sellerId) {
    return NextResponse.json({ error: "Faltan credenciales de París" }, { status: 400 });
  }

  try {
    const startDate = getFechaHaceDias(7);
    const endDate = new Date().toISOString().split("T")[0];

    const url = `https://api-developers.ecomm-stg.cencosud.com/v1/orders?gteCreatedAt=${startDate}&lteCreatedAt=${endDate}&sellerId=${sellerId}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const data = await response.json();
    const orders = data?.data || [];
    const insertedOrders = [];

    for (const order of orders) {
      for (const subOrder of order.subOrders) {
        for (const item of subOrder.items) {
          const result = await createOrder({
            orderId: `${order.id}-${subOrder.subOrderNumber}-${item.id}`,
            totalAmount: parseFloat(item.priceAfterDiscounts?.toString() || "0"),
            status: item.status?.name || "unknown",
            marketplace: MARKETPLACES.PARIS,
            productTitle: item.name || "Sin título",
            productQuantity: 1,
            deliveryDate: subOrder.arrivalDate || subOrder.dispatchDate || new Date().toISOString(),
          });

          insertedOrders.push(result);
        }
      }
    }

    return NextResponse.json({ inserted: insertedOrders });
  } catch (error) {
    console.error("Error en la API de París:", error);
    return NextResponse.json({ error: "Error en la API de París" }, { status: 500 });
  }
}
