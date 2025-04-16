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
            CreatedAfter: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
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
            const items = await fetchOrderItems(order.OrderId, timestamp, userId, apiKey);

            const groupedByName = new Map<string, typeof items>();
            for (const item of items) {
                const key = item?.Name || "Sin título";
                if (!groupedByName.has(key)) groupedByName.set(key, []);
                groupedByName.get(key)!.push(item);
            }

            let groupIndex = 1;

            for (const [name, groupItems] of groupedByName.entries()) {
                const totalAmount = groupItems.reduce((acc, item) => acc + parseFloat(item?.PaidPrice || '0') * parseInt(item?.Quantity || '1'), 0);
                const totalQuantity = groupItems.reduce((acc, item) => acc + parseInt(item?.Quantity || '1'), 0);

                const result = await createOrder({
                    orderId: `${order.OrderNumber}-G${groupIndex.toString().padStart(2, "0")}`,
                    totalAmount,
                    status: groupItems[0]?.Status || order.Statuses?.[0] || "unknown",
                    marketplace: MARKETPLACES.FALABELLA,
                    productTitle: name,
                    productQuantity: totalQuantity,
                    deliveryDate: order.PromisedShippingTime,
                });

                insertedOrders.push(result);
                groupIndex++;
            }

        }

        return NextResponse.json({ inserted: insertedOrders });
    } catch (error) {
        console.error("Error en la API de Falabella:", error);
        return NextResponse.json({ error: "Error en la API de Falabella" }, { status: 500 });
    }
}