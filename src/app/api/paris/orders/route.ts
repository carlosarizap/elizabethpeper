process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { createOrder } from "@/app/lib/actions/order-actions";
import { MARKETPLACES } from "@/app/lib/constants/marketplaces";
import { NextResponse } from "next/server";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

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

          // 🔧 Ajustar hora de entrega a las 18:00 en zona horaria de Chile
          const rawDate = subOrder.dispatchDate || new Date().toISOString();
          const deliveryDate = dayjs(rawDate)
            .tz("America/Santiago")
            .set("hour", 18)
            .set("minute", 0)
            .set("second", 0)
            .set("millisecond", 0)
            .toDate();

          const result = await createOrder({
            orderId: `${subOrder.subOrderNumber}-G${groupIndex.toString().padStart(2, "0")}`,
            totalAmount,
            status: items[0]?.status?.name || "unknown",
            marketplace: MARKETPLACES.PARIS,
            productTitle: name,
            productQuantity: totalQuantity,
            deliveryDate: deliveryDate.toISOString(), // <-- esta es la fecha correcta
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
