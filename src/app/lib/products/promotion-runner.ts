import pool from '@/app/lib/db';
import { getShopifyAccessToken } from '@/app/lib/shopify/token-manager';

const SHOPIFY_API_VERSION = '2026-01';

interface PromotionItem {
  id: string;
  external_product_id: string;
  external_variant_id: string;
  previous_price: string | null;
  previous_compare_at_price: string | null;
  regular_price: string | null;
  promotion_price: string | null;
}

interface ShopifyVariantInput {
  id: string;
  price: string;
  compareAtPrice: string | null;
}

async function shopifyGraphql<T>(query: string, variables: Record<string, unknown>) {
  const shop = process.env.SHOPIFY_SHOP;
  if (!shop) throw new Error('Falta SHOPIFY_SHOP.');
  const token = await getShopifyAccessToken();
  const response = await fetch(
    `https://${shop}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  const body = await response.json();
  if (!response.ok || body.errors?.length) {
    throw new Error(`Shopify respondió ${response.status}: ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.data as T;
}

async function updateProductVariants(productId: string, variants: ShopifyVariantInput[]) {
  const mutation = `#graphql
    mutation UpdatePromotionVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id price compareAtPrice }
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyGraphql<{
    productVariantsBulkUpdate: {
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(mutation, {
    productId: `gid://shopify/Product/${productId}`,
    variants,
  });
  const errors = data.productVariantsBulkUpdate.userErrors;
  if (errors.length) throw new Error(errors.map((error) => error.message).join('; '));
}

async function markItems(ids: string[], status: 'applied' | 'restored' | 'failed', error?: string) {
  await pool.query(
    `UPDATE product_promotion_item SET
       status = $2::text,
       last_error = $3,
       applied_at = CASE WHEN $2::text = 'applied' THEN NOW() ELSE applied_at END,
       restored_at = CASE WHEN $2::text = 'restored' THEN NOW() ELSE restored_at END,
       updated_at = NOW()
     WHERE id = ANY($1::uuid[])`,
    [ids, status, error ?? null],
  );
}

async function runShopifyItems(items: PromotionItem[], restore: boolean) {
  const groups = new Map<string, PromotionItem[]>();
  for (const item of items) {
    const existing = groups.get(item.external_product_id) ?? [];
    existing.push(item);
    groups.set(item.external_product_id, existing);
  }

  let updated = 0;
  let failed = 0;
  for (const [productId, productItems] of groups) {
    try {
      const variants = productItems.map((item) => ({
        id: `gid://shopify/ProductVariant/${item.external_variant_id}`,
        price: String(restore ? item.previous_price : item.promotion_price),
        compareAtPrice: restore
          ? (item.previous_compare_at_price ? String(item.previous_compare_at_price) : null)
          : String(item.regular_price),
      }));
      if (variants.some((variant) => !variant.price || variant.price === 'null')) {
        throw new Error('Una variante no tiene precio válido para la actualización.');
      }
      await updateProductVariants(productId, variants);
      await markItems(productItems.map((item) => item.id), restore ? 'restored' : 'applied');
      updated += productItems.length;
    } catch (error) {
      await markItems(
        productItems.map((item) => item.id),
        'failed',
        error instanceof Error ? error.message : String(error),
      );
      failed += productItems.length;
    }
  }
  return { updated, failed };
}

export async function runDueProductPromotions() {
  const dueStart = await pool.query<PromotionItem>(
    `SELECT i.*
     FROM product_promotion_item i
     JOIN product_promotion_campaign c ON c.id = i.campaign_id
     WHERE i.marketplace = 'shopify'
       AND i.status = 'scheduled'
       AND c.starts_at <= NOW()
       AND c.ends_at > NOW()
     ORDER BY i.external_product_id, i.external_variant_id`,
  );
  const dueEnd = await pool.query<PromotionItem>(
    `SELECT i.*
     FROM product_promotion_item i
     JOIN product_promotion_campaign c ON c.id = i.campaign_id
     WHERE i.marketplace = 'shopify'
       AND i.status = 'applied'
       AND c.ends_at <= NOW()
     ORDER BY i.external_product_id, i.external_variant_id`,
  );

  const activation = await runShopifyItems(dueStart.rows, false);
  const restoration = await runShopifyItems(dueEnd.rows, true);
  return { success: activation.failed === 0 && restoration.failed === 0, activation, restoration };
}
