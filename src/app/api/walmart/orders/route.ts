process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { createOrder } from "@/app/lib/actions/order-actions";
import { MARKETPLACES } from "@/app/lib/constants/marketplaces";
import { NextResponse } from "next/server";
import crypto from "crypto";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

function toBasicAuth(clientId: string, clientSecret: string): string {
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

function getFechaHaceDias(dias: number): string {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - dias);
  return fecha.toISOString().split("T")[0]; // yyyy-MM-dd
}

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getChargeAmount(charges: any, chargeType: string): number {
  const chargeList = toArray(charges?.charge);
  const found = chargeList.find((c) => c?.chargeType === chargeType);
  return Number(found?.chargeAmount?.amount ?? 0);
}

function getProductAmountWithTax(line: any): number {
  const chargeList = toArray(line?.charges?.charge);

  const productCharge = chargeList.find((c) => c?.chargeType === "PRODUCT");

  const baseAmount = Number(productCharge?.chargeAmount?.amount ?? 0);
  const taxAmount = Number(productCharge?.tax?.taxAmount?.amount ?? 0);

  return baseAmount + taxAmount;
}

function getSubtotalAmount(order: any, subTotalType: string): number {
  const subtotals = toArray(order?.orderSummary?.orderSubTotals);
  const found = subtotals.find((s) => s?.subTotalType === subTotalType);
  return Number(found?.totalAmount?.amount ?? 0);
}

function getShippingAmount(order: any): number {
  return getSubtotalAmount(order, "SHIPPING");
}

function getDeliveryDate(order: any): string | undefined {
  const estimatedShipDate = order?.shippingInfo?.estimatedShipDate;
  if (!estimatedShipDate) return undefined;

  return dayjs(Number(estimatedShipDate))
    .tz("America/Santiago")
    .format("YYYY-MM-DD");
}

function getLatestStatus(line: any): string {
  const statuses = toArray(line?.orderLineStatuses?.orderLineStatus);
  if (statuses.length === 0) return "unknown";
  return statuses[statuses.length - 1]?.status ?? "unknown";
}

async function getWalmartToken(): Promise<string> {
  const clientId = process.env.WALMART_CLIENT_ID;
  const clientSecret = process.env.WALMART_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Faltan credenciales de Walmart");
  }

  const response = await fetch("https://marketplace.walmartapis.com/v3/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${toBasicAuth(clientId, clientSecret)}`,
      WM_MARKET: "cl",
      "WM_SVC.NAME": "Walmart Marketplace",
      "WM_QOS.CORRELATION_ID": crypto.randomUUID(),
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Error token Walmart: ${JSON.stringify(data)}`);
  }

  return data.access_token as string;
}

async function fetchWalmartOrders(accessToken: string) {
  const clientId = process.env.WALMART_CLIENT_ID;
  const clientSecret = process.env.WALMART_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Faltan credenciales de Walmart");
  }

  const createdStartDate = getFechaHaceDias(6);
  const createdEndDate = getFechaHaceDias(0);

  const query = new URLSearchParams({
    createdStartDate,
    createdEndDate,
    limit: "200",
  });

  const url = `https://marketplace.walmartapis.com/v3/orders?${query.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Basic ${toBasicAuth(clientId, clientSecret)}`,
      "WM_SEC.ACCESS_TOKEN": accessToken,
      WM_MARKET: "cl",
      "WM_SVC.NAME": "Walmart Marketplace",
      "WM_QOS.CORRELATION_ID": crypto.randomUUID(),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Error orders Walmart: ${JSON.stringify(data)}`);
  }

  return data;
}

export async function GET() {
  try {
    const accessToken = await getWalmartToken();
    const data = await fetchWalmartOrders(accessToken);

    const orders = toArray(data?.list?.elements?.order);
    const insertedOrders = [];

    for (const order of orders) {
      const orderId = order?.purchaseOrderId?.toString();
      if (!orderId) continue;

      const shippingAmount = getShippingAmount(order);
      const deliveryDate = getDeliveryDate(order);
      const documentType: "boleta" | "factura" = "boleta";

      const lines = toArray(order?.orderLines?.orderLine);

      const groupedItems = new Map<
        string,
        {
          productTitle: string;
          totalQuantity: number;
          totalProductAmount: number;
          status: string;
        }
      >();

      for (const line of lines) {
        const sku = line?.item?.sku ?? "SIN-SKU";
        const productTitle = line?.item?.productName ?? "Sin título";
        const key = `${sku}||${productTitle}`;

        const quantity = Number(line?.orderLineQuantity?.amount ?? 1);
        const productAmount = getProductAmountWithTax(line);
        const status = getLatestStatus(line);

        if (!groupedItems.has(key)) {
          groupedItems.set(key, {
            productTitle,
            totalQuantity: 0,
            totalProductAmount: 0,
            status,
          });
        }

        const current = groupedItems.get(key)!;
        current.totalQuantity += quantity;
        current.totalProductAmount += productAmount;
        current.status = status;
      }

      for (const [, itemData] of groupedItems.entries()) {
        const unitPrice =
          itemData.totalQuantity > 0
            ? itemData.totalProductAmount / itemData.totalQuantity
            : 0;

        const result = await createOrder({
          orderId,
          shippingAmount,
          status: itemData.status,
          marketplace: MARKETPLACES.WALMART,
          documentType,
          productTitle: itemData.productTitle,
          productQuantity: itemData.totalQuantity,
          productPrice: unitPrice,
          deliveryDate,
        });

        insertedOrders.push(result);
      }
    }

    return NextResponse.json({
      inserted: insertedOrders,
      totalOrders: orders.length,
    });
  } catch (error) {
    console.error("Error en la API de Walmart:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Error en la API de Walmart",
      },
      { status: 500 }
    );
  }
}