process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { upsertFalabellaOrder } from '@/app/lib/actions/order-actions';
import { MARKETPLACES } from '@/app/lib/constants/marketplaces';
import { getFalabellaInvoiceData } from '@/app/lib/falabella/invoice-data';
import { normalizeMarketplaceOrderItemStatus } from '@/app/lib/orders/order-item-status';
import { normalizeOrderStatus } from '@/app/lib/orders/marketplace-status-mappers';
import { getMarketplaceSyncMode } from '@/app/lib/orders/marketplace-sync';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface FalabellaOrderItem {
  OrderItemId?: unknown;
  Sku?: unknown;
  ShopSku?: unknown;
  SellerSku?: unknown;
  Name?: unknown;
  Quantity?: unknown;
  PaidPrice?: unknown;
  Status?: unknown;
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return value.toString();
  return null;
}

function numericValue(value: unknown, fallback = 0): number {
  const parsed = Number.parseFloat(String(value ?? '').replace(',', ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readDays(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getMarketplaceItemId(
  item: FalabellaOrderItem,
  orderId: string,
  productTitle: string,
): string {
  const stableId =
    stringValue(item.OrderItemId) ??
    stringValue(item.Sku) ??
    stringValue(item.ShopSku) ??
    stringValue(item.SellerSku);

  if (stableId) return stableId;

  console.warn(
    `[Falabella] Item sin identificador estable en orden ${orderId}: ${productTitle}`,
  );
  return `legacy:${orderId}:${productTitle.trim().toLowerCase()}`;
}

function getTimestamp(): string {
  return new Date().toISOString();
}

function calculateSignature(
  params: Record<string, string>,
  apiKey: string,
): string {
  const sortedKeys = Object.keys(params).sort();
  const baseString = sortedKeys
    .map(
      (key) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`,
    )
    .join('&');
  return crypto.createHmac('sha256', apiKey).update(baseString).digest('hex');
}

async function fetchOrderItems(
  orderId: string,
  timestamp: string,
  userId: string,
  apiKey: string,
): Promise<FalabellaOrderItem[]> {
  const params: Record<string, string> = {
    Action: 'GetOrderItems',
    Format: 'JSON',
    Timestamp: timestamp,
    UserID: userId,
    Version: '1.0',
    OrderId: orderId,
  };

  const signature = calculateSignature(params, apiKey);
  params.Signature = signature;

  const url = `https://sellercenter-api.falabella.com/?${new URLSearchParams(params).toString()}`;
  const response = await fetch(url);
  const data = await response.json();
  const items = data?.SuccessResponse?.Body?.OrderItems?.OrderItem;

  if (!items) return [];
  return (Array.isArray(items) ? items : [items]) as FalabellaOrderItem[];
}

export async function GET(request: NextRequest) {
  const userId = process.env.FALABELLA_USER_ID!;
  const apiKey = process.env.FALABELLA_API_KEY!;
  const mode = getMarketplaceSyncMode(request.nextUrl.searchParams);
  const syncDays = readDays(process.env.FALABELLA_SYNC_DAYS, 4);
  const returnRecheckDays = readDays(
    process.env.FALABELLA_RETURN_RECHECK_DAYS,
    60,
  );
  const days = mode === 'returns' ? returnRecheckDays : syncDays;

  if (!userId || !apiKey) {
    return NextResponse.json({ error: 'Credenciales faltantes' }, { status: 400 });
  }

  try {
    const timestamp = getTimestamp();
    const baseParams = {
      Action: 'GetOrders',
      Format: 'JSON',
      Timestamp: timestamp,
      UserID: userId,
      Version: '1.0',
      CreatedAfter: new Date(
        Date.now() - 1000 * 60 * 60 * 24 * days,
      ).toISOString(),
    };
    const signature = calculateSignature(baseParams, apiKey);
    const queryParams = new URLSearchParams({
      ...baseParams,
      Signature: signature,
    }).toString();
    const response = await fetch(
      `https://sellercenter-api.falabella.com/?${queryParams}`,
    );
    const data = await response.json();
    const orders = data?.SuccessResponse?.Body?.Orders?.Order || [];
    const ordersArray = Array.isArray(orders) ? orders : [orders];
    const synchronizedOrders = [];

    for (const order of ordersArray) {
      const orderNumber = `${order.OrderNumber?.toString()}-${order.OrderId?.toString()}`;
      const orderId = order.OrderId?.toString();
      const documentType = order.InvoiceRequired === 'true' ? 'factura' : 'boleta';
      const shippingAmount = numericValue(order.ShippingFeeTotal);
      const deliveryDate = order.PromisedShippingTime ?? null;
      const items = await fetchOrderItems(orderId, timestamp, userId, apiKey);
      const invoiceData = getFalabellaInvoiceData(order);

      const standardizedStatus = normalizeOrderStatus(
        MARKETPLACES.FALABELLA,
        order.Statuses?.Status ?? null,
      );

      const groupedItems = new Map<
        string,
        {
          productTitle: string;
          quantity: number;
          totalPrice: number;
          rawStatus: string | null;
        }
      >();

      for (const item of items) {
        const productTitle = stringValue(item.Name) ?? 'Sin tÃ­tulo';
        const quantity = Math.max(1, Math.trunc(numericValue(item.Quantity, 1)));
        const price = numericValue(item.PaidPrice);
        const marketplaceItemId = getMarketplaceItemId(
          item,
          orderId,
          productTitle,
        );
        const rawStatus = stringValue(item.Status);
        const groupedItem = groupedItems.get(marketplaceItemId);

        if (groupedItem) {
          groupedItem.quantity += quantity;
          groupedItem.totalPrice += price * quantity;
          groupedItem.rawStatus = rawStatus ?? groupedItem.rawStatus;
        } else {
          groupedItems.set(marketplaceItemId, {
            productTitle,
            quantity,
            totalPrice: price * quantity,
            rawStatus,
          });
        }
      }

      const result = await upsertFalabellaOrder({
        orderId: orderNumber,
        shippingAmount,
        status: standardizedStatus,
        documentType,
        deliveryDate,
        companyRut: invoiceData.companyRut,
        billingCity: invoiceData.billingCity,
        items: Array.from(groupedItems, ([marketplaceItemId, item]) => ({
          marketplaceItemId,
          productTitle: item.productTitle,
          productQuantity: item.quantity,
          productPrice: item.totalPrice / item.quantity,
          status: normalizeMarketplaceOrderItemStatus(
            MARKETPLACES.FALABELLA,
            item.rawStatus,
          ),
          marketplaceStatus: item.rawStatus,
        })),
      });

      synchronizedOrders.push(result);
    }

    return NextResponse.json({
      mode,
      days,
      synchronized: synchronizedOrders.length,
      inserted: synchronizedOrders,
    });
  } catch (error) {
    console.error('Error en la API de Falabella:', error);
    return NextResponse.json(
      { error: 'Error en la API de Falabella' },
      { status: 500 },
    );
  }
}
