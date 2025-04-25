process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { createOrder } from "@/app/lib/actions/order-actions";
import { MARKETPLACES } from "@/app/lib/constants/marketplaces";
import { NextResponse } from "next/server";
import crypto from "crypto";

function getTimestamp(): string {
  return new Date().toISOString();
}

function calculateSignature(params: Record<string, string>, apiKey: string): string {
  const sortedKeys = Object.keys(params).sort();
  const baseString = sortedKeys.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`).join("&");
  return crypto.createHmac("sha256", apiKey).update(baseString).digest("hex");
}

async function fetchOrderItems(orderId: string, timestamp: string, userId: string, apiKey: string) {
  const params: Record<string, string> = {
    Action: 'GetOrderItems',
    Format: 'JSON',
    Timestamp: timestamp,
    UserID: userId,
    Version: '1.0',
    OrderId: orderId,
  };

  const signature = calculateSignature(params, apiKey);
  params['Signature'] = signature;

  const url = `https://sellercenter-api.falabella.com/?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url);
  const data = await res.json();

  const items = data?.SuccessResponse?.Body?.OrderItems?.OrderItem;
  if (!items) return [];

  return Array.isArray(items) ? items : [items];
}

export async function GET() {
  const userId = process.env.FALABELLA_USER_ID!;
  const apiKey = process.env.FALABELLA_API_KEY!;

  if (!userId || !apiKey) {
    return NextResponse.json({ error: "Credenciales faltantes" }, { status: 400 });
  }

  try {
    const timestamp = getTimestamp();
    const baseParams = {
      Action: "GetOrders",
      Format: "JSON",
      Timestamp: timestamp,
      UserID: userId,
      Version: "1.0",
      CreatedAfter: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
    };

    const signature = calculateSignature(baseParams, apiKey);
    const queryParams = new URLSearchParams({ ...baseParams, Signature: signature }).toString();
    const url = `https://sellercenter-api.falabella.com/?${queryParams}`;

    const response = await fetch(url);
    const data = await response.json();

    const orders = data?.SuccessResponse?.Body?.Orders?.Order || [];
    const ordersArray = Array.isArray(orders) ? orders : [orders];

    const insertedOrders = [];

    for (const order of ordersArray) {
      const orderNumber = order.OrderNumber?.toString(); // para guardar
      const orderId = order.OrderId?.toString();         // para consultar productos
      const documentType = order.InvoiceRequired === "true" ? "factura" : "boleta";
      const shippingAmount = parseFloat((order.ShippingFeeTotal ?? '0').replace(',', '')) || 0;
      const deliveryDate = order.PromisedShippingTime ?? null;

      const items = await fetchOrderItems(orderId, timestamp, userId, apiKey);

      // AGRUPAR productos por nombre
      const groupedItems = new Map<string, { quantity: number, totalPrice: number }>();

      for (const item of items) {
        const name = item?.Name ?? "Sin título";
        const quantity = parseInt(item?.Quantity ?? '1');
        const price = parseFloat(item?.PaidPrice?.replace(',', '') ?? '0');

        if (!groupedItems.has(name)) {
          groupedItems.set(name, { quantity: 0, totalPrice: 0 });
        }

        const current = groupedItems.get(name)!;
        current.quantity += quantity;
        current.totalPrice += price * quantity;
      }

      // Insertar agrupado
      for (const [name, data] of groupedItems.entries()) {
        const result = await createOrder({
          orderId: orderNumber,
          shippingAmount,
          status: items[0]?.Status || order.Statuses?.Status || "unknown",
          marketplace: MARKETPLACES.FALABELLA,
          documentType: documentType as 'boleta' | 'factura',
          productTitle: name,
          productQuantity: data.quantity,
          productPrice: data.totalPrice / data.quantity, // precio unitario promedio
          deliveryDate
        });

        insertedOrders.push(result);
      }
    }

    return NextResponse.json({ inserted: insertedOrders });

  } catch (error) {
    console.error("Error en la API de Falabella:", error);
    return NextResponse.json({ error: "Error en la API de Falabella" }, { status: 500 });
  }
}
