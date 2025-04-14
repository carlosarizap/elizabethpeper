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

    const url = `https://api-developers.ecomm.cencosud.com/v1/orders?gteCreatedAt=${startDate}&lteCreatedAt=${endDate}&sellerId=${sellerId}`;

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
        const groupedByName = new Map<string, typeof subOrder.items>();

        for (const item of subOrder.items) {
          const key = item?.name || "Sin título";
          if (!groupedByName.has(key)) groupedByName.set(key, []);
          groupedByName.get(key)!.push(item);
        }

        let groupIndex = 1;

        for (const [name, items] of groupedByName.entries()) {
          const totalAmount = items.reduce(
            (acc: number, item: any) => acc + parseFloat(item.priceAfterDiscounts?.toString() || "0"),
            0
          );
        
          const totalQuantity = items.length;
        
          const result = await createOrder({
            orderId: `${subOrder.subOrderNumber}-G${groupIndex.toString().padStart(2, "0")}`,
            totalAmount,
            status: items[0]?.status?.name || "unknown",
            marketplace: MARKETPLACES.PARIS,
            productTitle: name,
            productQuantity: totalQuantity,
            deliveryDate:  subOrder.dispatchDate || new Date().toISOString(),
          });
        
          insertedOrders.push(result);
          groupIndex++;
        }
        
      }
    }

    return NextResponse.json({ inserted: insertedOrders });
  } catch (error) {
    console.error("Error en la API de París:", error);
    return NextResponse.json({ error: "Error en la API de París" }, { status: 500 });
  }
}
