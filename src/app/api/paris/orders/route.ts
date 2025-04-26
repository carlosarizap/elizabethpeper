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
    const startDate = getFechaHaceDias(4);
    const endDate = getFechaHaceDias(-1);
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
        const shippingAmount = parseFloat(subOrder.cost ?? '0') || 0;

        const deliveryDate = dayjs(subOrder.dispatchDate || new Date().toISOString())
          .tz("America/Santiago")
          .set("hour", 18)
          .set("minute", 0)
          .set("second", 0)
          .set("millisecond", 0)
          .toISOString();

        const documentType = (order.originInvoiceType?.toLowerCase() === 'factura') ? 'factura' : 'boleta';

        // ⚡ Agrupar items por nombre
        const groupedItems = new Map<string, any[]>();

        for (const item of subOrder.items) {
          const key = item?.name || "Sin título";
          if (!groupedItems.has(key)) groupedItems.set(key, []);
          groupedItems.get(key)!.push(item);
        }

        for (const [name, items] of groupedItems.entries()) {
          const totalAmount = items.reduce(
            (acc, item) => acc + parseFloat(item.priceAfterDiscounts?.toString() || '0'),
            0
          );
          const totalQuantity = items.length;

          const result = await createOrder({
            orderId: subOrder.subOrderNumber, // solo subOrderNumber
            shippingAmount,
            status: items[0]?.status?.name || subOrder.status?.name || "unknown",
            marketplace: MARKETPLACES.PARIS,
            documentType: documentType as 'boleta' | 'factura',
            productTitle: name,
            productQuantity: totalQuantity,
            productPrice: totalAmount / totalQuantity, // ⚡ para guardar el precio unitario
            deliveryDate,
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