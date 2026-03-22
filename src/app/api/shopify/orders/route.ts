import { createOrder } from "@/app/lib/actions/order-actions";
import { MARKETPLACES } from "@/app/lib/constants/marketplaces";
import { NextResponse } from "next/server";

function calcularFechaEntrega(dateCreated: string): string {
  const fecha = new Date(dateCreated);
  fecha.setDate(fecha.getDate() + 1);

  const diaEntrega = fecha.getDay();
  if (diaEntrega === 6) fecha.setDate(fecha.getDate() + 2);
  if (diaEntrega === 0) fecha.setDate(fecha.getDate() + 1);

  return fecha.toISOString().split("T")[0];
}

function getFechaHaceDiasISO(dias: number): string {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - dias);
  return fecha.toISOString();
}

function toOrderId(shopifyGid?: string, orderName?: string): string {
  const numericId = shopifyGid?.split("/").pop() ?? "";
  if (orderName && numericId) {
    return `${orderName}-${numericId}`;
  }
  return numericId || orderName || "";
}

type ShopifyOrderEdge = {
  node?: {
    id?: string;
    name?: string;
    createdAt?: string;
    updatedAt?: string;
    displayFulfillmentStatus?: string;
    totalShippingPriceSet?: {
      shopMoney?: {
        amount?: string;
        currencyCode?: string;
      };
    };
    lineItems?: {
      edges?: Array<{
        node?: {
          title?: string;
          sku?: string | null;
          quantity?: number;
          originalUnitPriceSet?: {
            shopMoney?: {
              amount?: string;
              currencyCode?: string;
            };
          };
        };
      }>;
    };
  };
};

async function getShopifyAccessToken(): Promise<string> {
  const shop = process.env.SHOPIFY_SHOP;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!shop || !clientId || !clientSecret) {
    throw new Error("Faltan credenciales de Shopify");
  }

  const response = await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }).toString(),
  });

  const data = await response.json();

  if (!response.ok || !data?.access_token) {
    throw new Error(`Error token Shopify: ${JSON.stringify(data)}`);
  }

  return data.access_token as string;
}

async function fetchShopifyOrders(accessToken: string) {
  const shop = process.env.SHOPIFY_SHOP;

  if (!shop) {
    throw new Error("Falta SHOPIFY_SHOP");
  }

  const createdAtMin = getFechaHaceDiasISO(6);

  const query = `
    query GetOrders($q: String!) {
      orders(first: 50, query: $q, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            updatedAt
            displayFulfillmentStatus
            totalShippingPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            lineItems(first: 100) {
              edges {
                node {
                  title
                  sku
                  quantity
                  originalUnitPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const variables = {
    q: `created_at:>=${createdAtMin}`,
  };

  const response = await fetch(
    `https://${shop}.myshopify.com/admin/api/2026-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Error Shopify GraphQL: ${JSON.stringify(data)}`);
  }

  if (data?.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  return data;
}

export async function GET() {
  try {
    const accessToken = await getShopifyAccessToken();
    const data = await fetchShopifyOrders(accessToken);

    const orderEdges: ShopifyOrderEdge[] = data?.data?.orders?.edges ?? [];
    const insertedOrders = [];

    for (const edge of orderEdges) {
      const order = edge.node;
      if (!order) continue;

      const orderId = toOrderId(order.id, order.name);
      if (!orderId) continue;

      const shippingAmount = Number(
        order.totalShippingPriceSet?.shopMoney?.amount ?? 0
      );

      const deliveryDate = order.createdAt
        ? calcularFechaEntrega(order.createdAt)
        : undefined;

      const status = order.displayFulfillmentStatus ?? "UNKNOWN";
      const documentType: "boleta" | "factura" = "boleta";

      const lineEdges = order.lineItems?.edges ?? [];

      const groupedItems = new Map<
        string,
        {
          productTitle: string;
          totalQuantity: number;
          totalProductAmount: number;
        }
      >();

      for (const lineEdge of lineEdges) {
        const line = lineEdge.node;
        if (!line) continue;

        const productTitle = line.title ?? "Sin título";
        const sku = line.sku ?? "SIN-SKU";
        const quantity = Number(line.quantity ?? 1);
        const unitPrice = Number(
          line.originalUnitPriceSet?.shopMoney?.amount ?? 0
        );

        const key = `${sku}||${productTitle}`;

        if (!groupedItems.has(key)) {
          groupedItems.set(key, {
            productTitle,
            totalQuantity: 0,
            totalProductAmount: 0,
          });
        }

        const current = groupedItems.get(key)!;
        current.totalQuantity += quantity;
        current.totalProductAmount += unitPrice * quantity;
      }

      for (const [, itemData] of groupedItems.entries()) {
        const productPrice =
          itemData.totalQuantity > 0
            ? Math.round(itemData.totalProductAmount / itemData.totalQuantity)
            : 0;

        const result = await createOrder({
          orderId,
          shippingAmount,
          status,
          marketplace: MARKETPLACES.SHOPIFY,
          documentType,
          productTitle: itemData.productTitle,
          productQuantity: itemData.totalQuantity,
          productPrice,
          deliveryDate,
        });

        insertedOrders.push(result);
      }
    }

    return NextResponse.json({
      inserted: insertedOrders,
      totalOrders: orderEdges.length,
    });
  } catch (error) {
    console.error("Error en la API de Shopify:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Error en la API de Shopify",
      },
      { status: 500 }
    );
  }
}