import pool from "@/app/lib/db";
import axios from "axios";
import FormData from "form-data";
import { getShopifyAccessToken } from "./token-manager";

function parseShopifyOrderGid(orderId: string): string {
  if (orderId.startsWith("gid://shopify/Order/")) {
    return orderId;
  }

  // Soporta formatos como:
  // "#1019-6636471648480"
  // "6636471648480"
  const numericId = orderId.includes("-")
    ? orderId.split("-").pop()
    : orderId;

  if (!numericId || !/^\d+$/.test(numericId)) {
    throw new Error(`No se pudo derivar el GID de Shopify desde order_id: ${orderId}`);
  }

  return `gid://shopify/Order/${numericId}`;
}

async function shopifyGraphQL<T = any>(accessToken: string, query: string, variables?: Record<string, any>): Promise<T> {
  const shop = process.env.SHOPIFY_SHOP!;
  const response = await axios.post(
    `https://${shop}.myshopify.com/admin/api/2026-01/graphql.json`,
    { query, variables },
    {
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
    }
  );

  if (response.data?.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
  }

  return response.data as T;
}

async function createStagedUploadTarget(
  accessToken: string,
  filename: string,
  mimeType: string
) {
  const query = `
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters {
            name
            value
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    input: [
      {
        filename,
        mimeType,
        httpMethod: "POST",
        resource: "FILE",
      },
    ],
  };

  const data = await shopifyGraphQL<{
    data?: {
      stagedUploadsCreate?: {
        stagedTargets?: Array<{
          url: string;
          resourceUrl: string;
          parameters: Array<{ name: string; value: string }>;
        }>;
        userErrors?: Array<{ field?: string[]; message: string }>;
      };
    };
  }>(accessToken, query, variables);

  const payload = data.data?.stagedUploadsCreate;

  if (payload?.userErrors?.length) {
    throw new Error(`stagedUploadsCreate userErrors: ${JSON.stringify(payload.userErrors)}`);
  }

  const target = payload?.stagedTargets?.[0];
  if (!target) {
    throw new Error("Shopify no devolvió staged target.");
  }

  return target;
}

async function uploadPdfToStagedTarget(
  stagedUrl: string,
  parameters: Array<{ name: string; value: string }>,
  fileBuffer: Buffer,
  filename: string
) {
  const form = new FormData();

  for (const param of parameters) {
    form.append(param.name, param.value);
  }

  form.append("file", fileBuffer, {
    filename,
    contentType: "application/pdf",
  });

  await axios.post(stagedUrl, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
}

async function createShopifyFile(
  accessToken: string,
  resourceUrl: string,
  filename: string,
  altText: string
) {
  const query = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          fileStatus
          alt
          createdAt
          ... on GenericFile {
            url
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    files: [
      {
        alt: altText,
        contentType: "FILE",
        originalSource: resourceUrl,
        filename,
      },
    ],
  };

  const data = await shopifyGraphQL<{
    data?: {
      fileCreate?: {
        files?: Array<{
          id: string;
          fileStatus: string;
          alt?: string;
          createdAt?: string;
          url?: string;
        }>;
        userErrors?: Array<{ field?: string[]; message: string }>;
      };
    };
  }>(accessToken, query, variables);

  const payload = data.data?.fileCreate;

  if (payload?.userErrors?.length) {
    throw new Error(`fileCreate userErrors: ${JSON.stringify(payload.userErrors)}`);
  }

  const file = payload?.files?.[0];
  if (!file?.id) {
    throw new Error("Shopify no devolvió file id.");
  }

  return file;
}

async function attachInvoiceToOrderMetafield(
  accessToken: string,
  orderGid: string,
  fileGid: string
) {
  const query = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          type
          value
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  const variables = {
    metafields: [
      {
        namespace: "custom",
        key: "invoice_pdf",
        ownerId: orderGid,
        type: "file_reference",
        value: fileGid,
      },
    ],
  };

  const data = await shopifyGraphQL<{
    data?: {
      metafieldsSet?: {
        metafields?: Array<{
          id: string;
          namespace: string;
          key: string;
          type: string;
          value: string;
        }>;
        userErrors?: Array<{ field?: string[]; message: string; code?: string }>;
      };
    };
  }>(accessToken, query, variables);

  const payload = data.data?.metafieldsSet;

  if (payload?.userErrors?.length) {
    throw new Error(`metafieldsSet userErrors: ${JSON.stringify(payload.userErrors)}`);
  }

  return payload?.metafields?.[0];
}

export async function uploadInvoicesToShopify() {
  const client = await pool.connect();

  try {
    const { rows: orders } = await client.query(`
      SELECT id, order_id, invoice_pdf
      FROM order_header
      WHERE
        marketplace = 'shopify'
        AND has_invoice = true
        AND invoice_uploaded = false
        AND invoice_pdf IS NOT NULL
    `);

    if (orders.length === 0) {
      console.log("✅ No hay boletas pendientes de subir a Shopify.");
      return;
    }

    const accessToken = await getShopifyAccessToken();

    for (const order of orders) {
      try {
        const orderGid = parseShopifyOrderGid(order.order_id);
        const filename = `boleta_${order.order_id}.pdf`;
        const altText = `Boleta ${order.order_id}`;

        const stagedTarget = await createStagedUploadTarget(
          accessToken,
          filename,
          "application/pdf"
        );

        await uploadPdfToStagedTarget(
          stagedTarget.url,
          stagedTarget.parameters,
          Buffer.from(order.invoice_pdf),
          filename
        );

        const createdFile = await createShopifyFile(
          accessToken,
          stagedTarget.resourceUrl,
          filename,
          altText
        );

        await attachInvoiceToOrderMetafield(
          accessToken,
          orderGid,
          createdFile.id
        );

        await client.query(
          `
          UPDATE order_header
          SET invoice_uploaded = true
          WHERE id = $1
          `,
          [order.id]
        );

        console.log(`📤 Boleta subida y vinculada a Shopify para orden: ${order.order_id}`, {
          fileId: createdFile.id,
          fileStatus: createdFile.fileStatus,
          fileUrl: createdFile.url,
        });
      } catch (uploadError: any) {
        console.error(`❌ Error al subir boleta para orden Shopify: ${order.order_id}`);
        console.error(uploadError?.response?.data || uploadError?.message || uploadError);
      }
    }

    console.log("🏁 Proceso de carga de boletas a Shopify finalizado.");
  } catch (error) {
    console.error("Error general subiendo boletas a Shopify:", error);
  } finally {
    client.release();
  }
}